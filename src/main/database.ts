import { app } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import type {
  AppDatabase,
  AppSettings,
  GameInput,
  GameRecord,
  PlayPlanInput,
  PlayPlanRecord
} from '../shared/types';

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

function createDefaultPlans(): PlayPlanRecord[] {
  const timestamp = nowIso();
  return [
    { name: '30 Minutes', durationMinutes: 30, amountPaise: 5000 },
    { name: '1 Hour', durationMinutes: 60, amountPaise: 10000 },
    { name: '1 Hour 30 Minutes', durationMinutes: 90, amountPaise: 15000 }
  ].map((plan, index) => ({
    id: createId('plan'),
    ...plan,
    currency: 'INR',
    enabled: true,
    displayOrder: index,
    createdAt: timestamp,
    updatedAt: timestamp
  }));
}

function normalizePlan(input: PlayPlanInput, existing?: PlayPlanRecord, touchUpdatedAt = true): PlayPlanRecord {
  const timestamp = nowIso();
  const currency = (input.currency?.trim() || existing?.currency || 'INR').toUpperCase();
  const name = input.name.trim();
  const durationMinutes = Number(input.durationMinutes);
  const amountPaise = Number(input.amountPaise);
  if (!name) throw new Error('Plan name is required.');
  if (name.length > 80) throw new Error('Plan name must be 80 characters or fewer.');
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
    throw new Error('Duration must be a whole number between 1 and 1440 minutes.');
  }
  if (!Number.isInteger(amountPaise) || amountPaise < 100 || amountPaise > 10_000_000) {
    throw new Error('Price must be between ₹1 and ₹100,000.');
  }
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Currency must be a three-letter code such as INR.');
  return {
    id: input.id ?? existing?.id ?? createId('plan'),
    name,
    durationMinutes,
    amountPaise,
    currency,
    enabled: input.enabled ?? existing?.enabled ?? true,
    displayOrder: Number.isInteger(input.displayOrder)
      ? Number(input.displayOrder)
      : existing?.displayOrder ?? 0,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: touchUpdatedAt ? timestamp : existing?.updatedAt ?? timestamp
  };
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
        schemaVersion: 4,
        settings: DEFAULT_SETTINGS,
        games: [],
        plans: createDefaultPlans()
      };
      await this.persist();
      return;
    }

    const raw = await readFile(this.databasePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppDatabase>;
    const plans = (parsed.plans ?? []).flatMap((plan) => {
      try {
        return [normalizePlan(plan, plan, false)];
      } catch {
        return [];
      }
    });
    this.data = {
      schemaVersion: 4,
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
      }),
      plans: plans.length > 0 || Number(parsed.schemaVersion) >= 4 ? plans : createDefaultPlans()
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

  listPlans(enabledOnly = false): PlayPlanRecord[] {
    return structuredClone(this.requireData().plans)
      .filter((plan) => !enabledOnly || plan.enabled)
      .sort((a, b) => a.displayOrder - b.displayOrder || a.createdAt.localeCompare(b.createdAt));
  }

  getPlan(id: string): PlayPlanRecord | undefined {
    const plan = this.requireData().plans.find((item) => item.id === id);
    return plan ? structuredClone(plan) : undefined;
  }

  async savePlan(input: PlayPlanInput): Promise<PlayPlanRecord> {
    const data = this.requireData();
    const existingIndex = input.id ? data.plans.findIndex((plan) => plan.id === input.id) : -1;
    const existing = existingIndex >= 0 ? data.plans[existingIndex] : undefined;
    if (input.id && !existing) throw new Error('Plan not found.');
    const nextOrder = data.plans.reduce((maximum, plan) => Math.max(maximum, plan.displayOrder), -1) + 1;
    const plan = normalizePlan({ ...input, displayOrder: input.displayOrder ?? existing?.displayOrder ?? nextOrder }, existing);
    if (existingIndex >= 0) data.plans[existingIndex] = plan;
    else data.plans.push(plan);
    await this.persist();
    return structuredClone(plan);
  }

  async deletePlan(id: string): Promise<void> {
    const data = this.requireData();
    if (!data.plans.some((plan) => plan.id === id)) throw new Error('Plan not found.');
    data.plans = data.plans.filter((plan) => plan.id !== id);
    this.normalizePlanOrder(data.plans);
    await this.persist();
  }

  async setPlanEnabled(id: string, enabled: boolean): Promise<PlayPlanRecord> {
    const existing = this.getPlan(id);
    if (!existing) throw new Error('Plan not found.');
    return this.savePlan({ ...existing, enabled });
  }

  async reorderPlans(orderedIds: string[]): Promise<PlayPlanRecord[]> {
    const data = this.requireData();
    if (orderedIds.length !== data.plans.length || new Set(orderedIds).size !== data.plans.length) {
      throw new Error('Plan order is incomplete.');
    }
    const byId = new Map(data.plans.map((plan) => [plan.id, plan]));
    if (orderedIds.some((id) => !byId.has(id))) throw new Error('Plan order contains an unknown plan.');
    data.plans = orderedIds.map((id) => byId.get(id)!);
    this.normalizePlanOrder(data.plans);
    await this.persist();
    return this.listPlans();
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

  private normalizePlanOrder(plans: PlayPlanRecord[]): void {
    plans.forEach((plan, index) => {
      plan.displayOrder = index;
      plan.updatedAt = nowIso();
    });
  }

  private async persist(): Promise<void> {
    const data = this.requireData();
    const tempPath = `${this.databasePath}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await rename(tempPath, this.databasePath);
  }
}
