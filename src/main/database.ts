import { app } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import type { AppDatabase, AppSettings, GameInput, GameRecord } from '../shared/types';

const DEFAULT_SETTINGS: AppSettings = {
  adminPin: '1234',
  sessionDurationsMinutes: [30, 60, 90],
  kiosk: {
    alwaysOnTop: false,
    hideCursorAfterSeconds: 5,
    preventClose: true,
    refocusOnBlur: false
  },
  controllerIdle: {
    autoTurnOffMinutes: 10,
    shutdownWarning: true
  }
};

const CONTROLLER_IDLE_TIMEOUTS = new Set([0, 5, 10, 15, 30]);

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function assertExistingFile(path: string, allowedExtensions: string[], label: string): void {
  if (!existsSync(path)) {
    throw new Error(`${label} not found: ${path}`);
  }
  const stats = statSync(path);
  if (!stats.isFile()) {
    throw new Error(`${label} must be a file: ${path}`);
  }
  const extension = extname(path).toLowerCase();
  if (!allowedExtensions.includes(extension)) {
    throw new Error(`${label} must be one of: ${allowedExtensions.join(', ')}`);
  }
}

function assertExistingDirectory(path: string, label: string): void {
  if (!existsSync(path)) {
    throw new Error(`${label} not found: ${path}`);
  }
  if (!statSync(path).isDirectory()) {
    throw new Error(`${label} must be a folder: ${path}`);
  }
}

function validateGameInput(input: GameInput): void {
  const avatarImagePath = input.avatarImagePath?.trim();
  if (avatarImagePath && !/^https?:\/\//i.test(avatarImagePath)) {
    assertExistingFile(avatarImagePath, ['.png', '.jpg', '.jpeg', '.webp'], 'Avatar image');
  }

  const coverImagePath = input.coverImagePath?.trim();
  if (coverImagePath && !/^https?:\/\//i.test(coverImagePath)) {
    assertExistingFile(coverImagePath, ['.png', '.jpg', '.jpeg', '.webp'], 'Cover image');
  }

  if (input.launchType === 'localExe') {
    assertExistingFile(input.launchCommand.trim(), ['.exe'], 'Local executable');
  }

  const workingDirectory = input.workingDirectory?.trim();
  if (workingDirectory) {
    assertExistingDirectory(workingDirectory, 'Working directory');
  }
}

function normalizeGame(input: GameInput, existing?: GameRecord): GameRecord {
  const timestamp = nowIso();
  const enabled = input.enabled ?? existing?.enabled ?? true;
  const availabilityStatus = enabled ? input.availabilityStatus ?? existing?.availabilityStatus ?? 'unknown' : 'disabled';

  return {
    id: input.id ?? existing?.id ?? createId('game'),
    title: input.title.trim(),
    avatarImagePath: input.avatarImagePath?.trim() ?? existing?.avatarImagePath ?? '',
    coverImagePath: input.coverImagePath?.trim() ?? existing?.coverImagePath ?? '',
    source: input.source?.trim() ?? existing?.source ?? 'Manual',
    availabilityStatus,
    launchType: input.launchType,
    launchCommand: input.launchCommand.trim(),
    workingDirectory: input.workingDirectory?.trim() ?? existing?.workingDirectory ?? '',
    processName: input.processName?.trim() ?? existing?.processName ?? '',
    launchArguments: input.launchArguments?.trim() ?? existing?.launchArguments ?? '',
    launchMode: input.launchMode ?? existing?.launchMode ?? 'borderlessPreferred',
    enabled,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp
  };
}

export class DataStore {
  private databasePath = join(app.getPath('userData'), 'nxgs-play-data.json');
  private data: AppDatabase | null = null;

  get path(): string {
    return this.databasePath;
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.databasePath), { recursive: true });

    if (!existsSync(this.databasePath)) {
      this.data = {
        schemaVersion: 3,
        settings: DEFAULT_SETTINGS,
        games: []
      };
      await this.persist();
      return;
    }

    const raw = await readFile(this.databasePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppDatabase>;
    this.data = {
      schemaVersion: 3,
      settings: {
        ...DEFAULT_SETTINGS,
        ...(parsed.settings ?? {}),
        kiosk: {
          ...DEFAULT_SETTINGS.kiosk,
          ...(parsed.settings?.kiosk ?? {})
        },
        controllerIdle: {
          ...DEFAULT_SETTINGS.controllerIdle,
          ...(parsed.settings?.controllerIdle ?? {})
        }
      },
      games: (parsed.games ?? []).map((game) => {
        const legacyCover = game.coverImagePath ?? '';
        const avatarImagePath = game.avatarImagePath ?? legacyCover;
        return {
          ...game,
          avatarImagePath,
          coverImagePath: legacyCover || avatarImagePath,
          launchMode: game.launchMode ?? 'borderlessPreferred'
        };
      })
    };
    await this.persist();
  }

  listGames(): GameRecord[] {
    return [...this.requireData().games].sort((a, b) => a.title.localeCompare(b.title));
  }

  getGame(id: string): GameRecord | undefined {
    return this.requireData().games.find((game) => game.id === id);
  }

  async saveGame(input: GameInput): Promise<GameRecord> {
    if (!input.title.trim()) {
      throw new Error('Game title is required.');
    }
    if (!input.launchCommand.trim()) {
      throw new Error('Launch command is required.');
    }
    validateGameInput(input);

    const data = this.requireData();
    const existingIndex = input.id ? data.games.findIndex((game) => game.id === input.id) : -1;
    const existing = existingIndex >= 0 ? data.games[existingIndex] : undefined;
    const game = normalizeGame(input, existing);

    if (existingIndex >= 0) {
      data.games[existingIndex] = game;
    } else {
      data.games.push(game);
    }

    await this.persist();
    return game;
  }

  async deleteGame(id: string): Promise<void> {
    const data = this.requireData();
    data.games = data.games.filter((game) => game.id !== id);
    await this.persist();
  }

  getSettings(): AppSettings {
    return structuredClone(this.requireData().settings);
  }

  async updateSettings(settings: AppSettings): Promise<AppSettings> {
    const data = this.requireData();
    const durations = [...new Set(settings.sessionDurationsMinutes.map(Number))]
      .filter((minutes) => Number.isFinite(minutes) && minutes > 0)
      .sort((a, b) => a - b);

    data.settings = {
      adminPin: settings.adminPin?.trim() || data.settings.adminPin,
      sessionDurationsMinutes: durations.length > 0 ? durations : DEFAULT_SETTINGS.sessionDurationsMinutes,
      kiosk: {
        alwaysOnTop: Boolean(settings.kiosk.alwaysOnTop),
        hideCursorAfterSeconds: Math.max(0, Number(settings.kiosk.hideCursorAfterSeconds) || 0),
        preventClose: Boolean(settings.kiosk.preventClose),
        refocusOnBlur: Boolean(settings.kiosk.refocusOnBlur)
      },
      controllerIdle: {
        autoTurnOffMinutes: CONTROLLER_IDLE_TIMEOUTS.has(Number(settings.controllerIdle?.autoTurnOffMinutes))
          ? settings.controllerIdle.autoTurnOffMinutes
          : DEFAULT_SETTINGS.controllerIdle.autoTurnOffMinutes,
        shutdownWarning: settings.controllerIdle?.shutdownWarning !== false
      }
    };
    await this.persist();
    return this.getSettings();
  }

  verifyPin(pin: string): boolean {
    return this.requireData().settings.adminPin === pin;
  }

  private requireData(): AppDatabase {
    if (!this.data) {
      throw new Error('Data store has not been initialized.');
    }
    return this.data;
  }

  private async persist(): Promise<void> {
    const data = this.requireData();
    const tempPath = `${this.databasePath}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await rename(tempPath, this.databasePath);
  }
}
