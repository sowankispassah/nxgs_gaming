import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { basename, dirname, extname, join, parse } from 'node:path';
import type { GameSuggestion, LaunchType } from '../shared/types';
import { logLine } from './logger';

const execFileAsync = promisify(execFile);

interface StartAppRecord {
  Name?: string;
  AppID?: string;
}

interface AppxPackageRecord {
  Name?: string;
  PackageFamilyName?: string;
}

interface ShortcutRecord {
  TargetPath?: string;
  Arguments?: string;
  IconLocation?: string;
  WorkingDirectory?: string;
}

function suggestionId(prefix: string, key: string): string {
  return `${prefix}_${Buffer.from(key).toString('base64url').slice(0, 20)}`;
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

function parseJsonList<T>(raw: string): T[] {
  if (!raw.trim()) {
    return [];
  }
  const parsed = JSON.parse(raw) as T | T[];
  if (!parsed) {
    return [];
  }
  return Array.isArray(parsed) ? parsed : [parsed];
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

function isNoisyStartApp(title: string): boolean {
  return /uninstall|readme|manual|help|website|documentation|license|eula/i.test(title);
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
  launchMethod: string;
  status: GameSuggestion['status'];
  iconPath?: string;
  notes: string;
}): GameSuggestion {
  return {
    suggestionId: suggestionId(input.detectionSource, input.key),
    title: input.title,
    source: input.source,
    availabilityStatus: input.status === 'unsupported' ? 'unknown' : 'available',
    launchType: input.launchType,
    launchCommand: input.launchCommand,
    workingDirectory: input.workingDirectory ?? '',
    processName: input.processName ?? '',
    launchArguments: '',
    coverImagePath: '',
    enabled: input.status !== 'unsupported',
    detectionSource: input.detectionSource,
    confidence: input.confidence,
    launchMethod: input.launchMethod,
    status: input.status,
    iconPath: input.iconPath,
    notes: input.notes
  };
}

export async function scanInstalledGames(): Promise<GameSuggestion[]> {
  if (process.platform !== 'win32') {
    return [];
  }

  const results: GameSuggestion[] = [];
  const seen = new Set<string>();

  for (const scanner of [scanSteam, scanEpic, scanMicrosoftStoreApps, scanStartMenu, scanCommonFolders]) {
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

async function runPowerShellJson<T>(script: string): Promise<T[]> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 8
    }
  );
  return parseJsonList<T>(stdout);
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
          launchMethod: 'Steam URI',
          status: 'ready',
          notes: 'Detected from Steam library manifest. Process monitoring is best when a process name is also known.'
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
          launchMethod: launchCommand.startsWith('com.epicgames') ? 'Epic URI' : 'Local executable',
          status: 'ready',
          notes: 'Detected from Epic Games Launcher manifest.'
        })
      );
    } catch {
      continue;
    }
  }
  return suggestions;
}

async function scanMicrosoftStoreApps(): Promise<GameSuggestion[]> {
  const [startApps, packages] = await Promise.all([
    runPowerShellJson<StartAppRecord>('Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Depth 2'),
    runPowerShellJson<AppxPackageRecord>('Get-AppxPackage | Select-Object Name,PackageFamilyName | ConvertTo-Json -Depth 2')
  ]);
  const packageFamilies = new Set(
    packages
      .map((pkg) => pkg.PackageFamilyName?.toLowerCase())
      .filter((family): family is string => Boolean(family))
  );

  return startApps
    .filter((app) => app.Name && app.AppID && !isNoisyStartApp(app.Name))
    .filter((app) => {
      const appId = app.AppID?.toLowerCase() ?? '';
      const packageFamily = appId.split('!')[0];
      return appId.includes('!') && packageFamilies.has(packageFamily);
    })
    .map((app) =>
      makeSuggestion({
        key: app.AppID ?? app.Name ?? '',
        title: app.Name ?? 'Microsoft Store App',
        source: 'Microsoft Store',
        launchType: 'microsoftStore',
        launchCommand: app.AppID ?? '',
        detectionSource: 'microsoft-store',
        confidence: 'high',
        launchMethod: 'AppUserModelId',
        status: 'ready',
        notes:
          'Detected from Windows Start Apps/Appx packages. UWP process monitoring is best-effort; the session timer remains authoritative.'
      })
    );
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
          source: 'Local',
          launchType: 'localExe',
          launchCommand: best,
          workingDirectory: dirname(best),
          processName: basename(best),
          detectionSource: 'folder',
          confidence: 'medium',
          launchMethod: 'Local executable',
          status: 'needs-confirmation',
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
    const shortcuts = await findFiles(root, '.lnk', 4, 220);
    for (const shortcut of shortcuts) {
      const title = parse(shortcut).name;
      if (!title || isNoisyStartApp(title)) {
        continue;
      }
      const resolved = await resolveShortcut(shortcut);
      const targetPath = resolved?.TargetPath?.trim() ?? '';
      const iconPath = normalizeIconPath(resolved?.IconLocation);

      if (targetPath && extname(targetPath).toLowerCase() === '.exe' && existsSync(targetPath)) {
        suggestions.push(
          makeSuggestion({
            key: targetPath,
            title,
            source: 'Start Menu',
            launchType: 'localExe',
            launchCommand: targetPath,
            workingDirectory: resolved?.WorkingDirectory || dirname(targetPath),
            processName: basename(targetPath),
            detectionSource: 'start-menu',
            confidence: 'medium',
            launchMethod: 'Resolved shortcut executable',
            status: 'ready',
            iconPath,
            notes: 'Detected from Start Menu shortcut and resolved to an executable target.'
          })
        );
      } else {
        suggestions.push(
          makeSuggestion({
            key: shortcut,
            title,
            source: 'Start Menu',
            launchType: 'custom',
            launchCommand: `start "" "${shortcut}"`,
            workingDirectory: dirname(shortcut),
            detectionSource: 'start-menu',
            confidence: 'low',
            launchMethod: 'Start Menu shortcut',
            status: 'needs-confirmation',
            iconPath,
            notes: 'Detected Start Menu shortcut. Use when no normal executable or Store app entry is available.'
          })
        );
      }
    }
  }
  return suggestions;
}

async function resolveShortcut(shortcutPath: string): Promise<ShortcutRecord | null> {
  const script = `
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut(${psQuote(shortcutPath)})
    [pscustomobject]@{
      TargetPath = $shortcut.TargetPath
      Arguments = $shortcut.Arguments
      IconLocation = $shortcut.IconLocation
      WorkingDirectory = $shortcut.WorkingDirectory
    } | ConvertTo-Json -Depth 2
  `;
  try {
    const records = await runPowerShellJson<ShortcutRecord>(script);
    return records[0] ?? null;
  } catch (error) {
    await logLine('warn', `Shortcut resolve failed for ${shortcutPath}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function normalizeIconPath(iconLocation?: string): string | undefined {
  const raw = iconLocation?.split(',')[0]?.trim();
  return raw && existsSync(raw) ? raw : undefined;
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
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
