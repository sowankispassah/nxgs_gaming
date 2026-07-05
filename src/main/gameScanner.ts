import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, extname, join, parse } from 'node:path';
import type { GameSuggestion, LaunchType } from '../shared/types';
import { logLine } from './logger';

function suggestionId(prefix: string, key: string): string {
  return `${prefix}_${Buffer.from(key).toString('base64url').slice(0, 20)}`;
}

function stripQuotes(value: string): string {
  return value.replace(/^"|"$/g, '').trim();
}

function parseVdfPairs(content: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  const pattern = /"([^"]+)"\s+"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    pairs[match[1]] = match[2];
  }
  return pairs;
}

function isLikelyGameExe(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (!lower.endsWith('.exe')) {
    return false;
  }
  return !['unins', 'uninstall', 'setup', 'install', 'redist', 'vcredist', 'crash', 'unitycrashhandler'].some((part) =>
    lower.includes(part)
  );
}

function makeSuggestion(input: {
  key: string;
  title: string;
  source: string;
  launchType: LaunchType;
  launchCommand: string;
  workingDirectory?: string;
  processName?: string;
  detectionSource: GameSuggestion['detectionSource'];
  confidence: GameSuggestion['confidence'];
  notes: string;
}): GameSuggestion {
  return {
    suggestionId: suggestionId(input.detectionSource, input.key),
    title: input.title,
    source: input.source,
    availabilityStatus: 'available',
    launchType: input.launchType,
    launchCommand: input.launchCommand,
    workingDirectory: input.workingDirectory ?? '',
    processName: input.processName ?? '',
    launchArguments: '',
    coverImagePath: '',
    enabled: true,
    detectionSource: input.detectionSource,
    confidence: input.confidence,
    notes: input.notes
  };
}

export async function scanInstalledGames(): Promise<GameSuggestion[]> {
  if (process.platform !== 'win32') {
    return [];
  }

  const results: GameSuggestion[] = [];
  const seen = new Set<string>();

  for (const scanner of [scanSteam, scanEpic, scanCommonFolders, scanStartMenu]) {
    try {
      const found = await scanner();
      for (const suggestion of found) {
        const key = `${suggestion.launchType}:${suggestion.launchCommand}`.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          results.push(suggestion);
        }
      }
    } catch (error) {
      await logLine('warn', `Game scan step failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return results.sort((a, b) => a.title.localeCompare(b.title));
}

async function scanSteam(): Promise<GameSuggestion[]> {
  const steamRoots = [
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Steam'),
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Steam')
  ].filter((root, index, array) => array.indexOf(root) === index && existsSync(root));

  const libraryRoots = new Set<string>();
  for (const root of steamRoots) {
    libraryRoots.add(root);
    const libraryFile = join(root, 'steamapps', 'libraryfolders.vdf');
    if (!existsSync(libraryFile)) {
      continue;
    }
    const content = await readFile(libraryFile, 'utf8');
    const pathMatches = [...content.matchAll(/"path"\s+"([^"]+)"/g)];
    for (const match of pathMatches) {
      libraryRoots.add(match[1].replace(/\\\\/g, '\\'));
    }
  }

  const suggestions: GameSuggestion[] = [];
  for (const root of libraryRoots) {
    const steamApps = join(root, 'steamapps');
    if (!existsSync(steamApps)) {
      continue;
    }
    const files = await readdir(steamApps);
    for (const file of files.filter((name) => /^appmanifest_\d+\.acf$/i.test(name))) {
      const manifest = parseVdfPairs(await readFile(join(steamApps, file), 'utf8'));
      const appId = manifest.appid;
      const title = manifest.name;
      if (!appId || !title) {
        continue;
      }
      const installDir = manifest.installdir ? join(steamApps, 'common', manifest.installdir) : '';
      suggestions.push(
        makeSuggestion({
          key: appId,
          title,
          source: 'Steam',
          launchType: 'steam',
          launchCommand: `steam://run/${appId}`,
          workingDirectory: installDir,
          detectionSource: 'steam',
          confidence: 'high',
          notes: 'Detected from Steam library manifest. Add the process name for reliable return-to-launcher monitoring.'
        })
      );
    }
  }
  return suggestions;
}

async function scanEpic(): Promise<GameSuggestion[]> {
  const manifestRoot = 'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests';
  if (!existsSync(manifestRoot)) {
    return [];
  }

  const suggestions: GameSuggestion[] = [];
  const files = await readdir(manifestRoot);
  for (const file of files.filter((name) => name.endsWith('.item'))) {
    try {
      const item = JSON.parse(await readFile(join(manifestRoot, file), 'utf8')) as Record<string, string>;
      const title = item.DisplayName;
      if (!title) {
        continue;
      }
      const executable = item.LaunchExecutable && item.InstallLocation ? join(item.InstallLocation, item.LaunchExecutable) : '';
      const launchCommand =
        item.AppName && item.CatalogNamespace && item.CatalogItemId
          ? `com.epicgames.launcher://apps/${item.CatalogNamespace}:${item.CatalogItemId}:${item.AppName}?action=launch&silent=true`
          : executable;
      suggestions.push(
        makeSuggestion({
          key: item.AppName ?? title,
          title,
          source: 'Epic Games',
          launchType: launchCommand.startsWith('com.epicgames') ? 'epic' : 'localExe',
          launchCommand,
          workingDirectory: item.InstallLocation ?? (executable ? dirname(executable) : ''),
          processName: executable ? basename(executable) : '',
          detectionSource: 'epic',
          confidence: executable || launchCommand.startsWith('com.epicgames') ? 'high' : 'medium',
          notes: 'Detected from Epic Games Launcher manifest.'
        })
      );
    } catch {
      continue;
    }
  }
  return suggestions;
}

async function scanCommonFolders(): Promise<GameSuggestion[]> {
  const roots = ['C:\\Games', 'D:\\Games', process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(
    (value): value is string => Boolean(value && existsSync(value))
  );

  const suggestions: GameSuggestion[] = [];
  for (const root of roots) {
    const topLevel = await safeReaddir(root);
    for (const entry of topLevel.slice(0, 150)) {
      const folder = join(root, entry);
      if (!(await isDirectory(folder))) {
        continue;
      }
      const exes = await findExecutables(folder, 2, 35);
      if (exes.length === 0) {
        continue;
      }
      const best = exes.find((exe) => parse(exe).name.toLowerCase() === entry.toLowerCase()) ?? exes[0];
      suggestions.push(
        makeSuggestion({
          key: best,
          title: entry,
          source: 'Local Folder',
          launchType: 'localExe',
          launchCommand: best,
          workingDirectory: dirname(best),
          processName: basename(best),
          detectionSource: 'folder',
          confidence: 'medium',
          notes: `Detected executable in ${root}. Confirm this is the intended game launcher before saving.`
        })
      );
    }
  }
  return suggestions;
}

async function scanStartMenu(): Promise<GameSuggestion[]> {
  const roots = [
    join(process.env.ProgramData ?? 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs'),
    join(process.env.AppData ?? '', 'Microsoft\\Windows\\Start Menu\\Programs')
  ].filter((root) => root && existsSync(root));

  const suggestions: GameSuggestion[] = [];
  for (const root of roots) {
    const shortcuts = await findFiles(root, '.lnk', 3, 100);
    for (const shortcut of shortcuts) {
      const title = parse(shortcut).name;
      if (!title || /uninstall|readme|website/i.test(title)) {
        continue;
      }
      suggestions.push(
        makeSuggestion({
          key: shortcut,
          title,
          source: 'Custom',
          launchType: 'custom',
          launchCommand: `start "" "${shortcut}"`,
          workingDirectory: dirname(shortcut),
          detectionSource: 'start-menu',
          confidence: 'low',
          notes: 'Detected Start Menu shortcut. Windows shortcut targets are not inspected in this MVP.'
        })
      );
    }
  }
  return suggestions;
}

async function safeReaddir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function findExecutables(root: string, depth: number, limit: number): Promise<string[]> {
  const matches = await findFiles(root, '.exe', depth, limit);
  return matches.filter((file) => isLikelyGameExe(basename(file)));
}

async function findFiles(root: string, extension: string, depth: number, limit: number): Promise<string[]> {
  const matches: string[] = [];
  async function walk(folder: string, remainingDepth: number): Promise<void> {
    if (matches.length >= limit || remainingDepth < 0) {
      return;
    }
    const entries = await safeReaddir(folder);
    for (const entry of entries) {
      if (matches.length >= limit) {
        return;
      }
      const fullPath = join(folder, entry);
      try {
        const entryStat = await stat(fullPath);
        if (entryStat.isDirectory()) {
          await walk(fullPath, remainingDepth - 1);
        } else if (extname(entry).toLowerCase() === extension) {
          matches.push(fullPath);
        }
      } catch {
        continue;
      }
    }
  }
  await walk(root, depth);
  return matches;
}
