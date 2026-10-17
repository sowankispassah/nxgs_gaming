import { app } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { hostname } from 'node:os';
import type {
  AppDatabase,
  AppSettings,
  CachedModeratorCredential,
  DeviceInput,
  DeviceManagerSummary,
  DeviceRecord,
  DeviceStatus,
  EarningsQuery,
  EarningsSessionRow,
  GameInput,
  GameRecord,
  LocalSessionRecord,
  PaymentPayerDetails,
  PlayPlanInput,
  PlayPlanRecord,
  SessionGamePlay,
  StationCloudState
} from '../shared/types';
import { normalizePayerDetails, normalizePayerList, upsertPayer } from '../shared/earnings';
import { isValidPin, verifyPinHash } from './pinHash';

export interface PinIdentity {
  ok: boolean;
  role?: 'admin' | 'moderator';
  moderatorName?: string;
}

/** Device fields the main admin can change from Device Management. */
export interface OwnerDeviceFields {
  name: string;
  storeName: string;
  location: string;
  status: DeviceStatus;
}

export interface GameOverride {
  gameId: string;
  enabled: boolean;
}

type SessionGameSource = Pick<GameRecord, 'id' | 'title'>;

const DEFAULT_SETTINGS: AppSettings = {
  adminPin: '1234',
  playAccessMode: 'paid',
  sessionDurationsMinutes: [30, 60, 90],
  branding: {
    logoPath: ''
  },
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
const SCHEMA_VERSION = 7;

function nowIso(): string {
  return new Date().toISOString();
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeCloudState(input: Partial<StationCloudState> | undefined): StationCloudState {
  const moderators = Array.isArray(input?.moderators)
    ? input.moderators.flatMap((moderator) => {
      const id = optionalText(moderator?.id);
      const pinHash = optionalText(moderator?.pinHash);
      return id && pinHash ? [{ id, name: optionalText(moderator.name) ?? 'Moderator', pinHash }] : [];
    })
    : [];
  const state: StationCloudState = { removedByOwner: input?.removedByOwner === true, moderators };
  for (const key of ['stationToken', 'registeredAt', 'lastSyncAt', 'lastSyncError'] as const) {
    const value = optionalText(input?.[key]);
    if (value) state[key] = value;
  }
  return state;
}

function normalizeSessionGames(value: unknown, closeOpenAt?: string): SessionGamePlay[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Partial<SessionGamePlay>;
    const gameId = optionalText(row.gameId);
    const startedAt = optionalText(row.startedAt);
    if (!gameId || !startedAt) return [];
    const endedAt = optionalText(row.endedAt) ?? closeOpenAt;
    return [{
      gameId,
      title: optionalText(row.title) ?? gameId,
      startedAt,
      ...(endedAt ? { endedAt } : {})
    }];
  });
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createDefaultDevice(): DeviceRecord {
  const timestamp = nowIso();
  return {
    id: createId('device'),
    name: hostname().trim() || 'NXGS PC',
    storeName: '',
    location: '',
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
    syncStatus: 'pending'
  };
}

function normalizeDevice(
  input: DeviceInput & Partial<DeviceRecord>,
  existing?: DeviceRecord,
  touchUpdatedAt = true
): DeviceRecord {
  const timestamp = nowIso();
  const name = input.name?.trim();
  const storeName = input.storeName?.trim() ?? existing?.storeName ?? '';
  const location = input.location?.trim() ?? existing?.location ?? '';
  if (!name) throw new Error('Device name is required.');
  if (name.length > 80) throw new Error('Device name must be 80 characters or fewer.');
  if (storeName.length > 120) throw new Error('Store or branch name must be 120 characters or fewer.');
  if (location.length > 160) throw new Error('Device location must be 160 characters or fewer.');
  return {
    id: input.id ?? existing?.id ?? createId('device'),
    name,
    storeName,
    location,
    status: (input.status ?? existing?.status) === 'inactive' ? 'inactive' : 'active',
    createdAt: existing?.createdAt ?? input.createdAt ?? timestamp,
    updatedAt: touchUpdatedAt ? timestamp : input.updatedAt ?? existing?.updatedAt ?? timestamp,
    lastSyncedAt: input.lastSyncedAt ?? existing?.lastSyncedAt,
    syncedAt: input.syncedAt ?? existing?.syncedAt,
    deletedAt: input.deletedAt ?? existing?.deletedAt,
    syncStatus: touchUpdatedAt ? 'pending' : input.syncStatus ?? existing?.syncStatus ?? 'pending'
  };
}

function createDefaultPlans(deviceId: string): PlayPlanRecord[] {
  const timestamp = nowIso();
  return [
    { name: '30 Minutes', durationMinutes: 30, amountPaise: 5000 },
    { name: '1 Hour', durationMinutes: 60, amountPaise: 10000 },
    { name: '1 Hour 30 Minutes', durationMinutes: 90, amountPaise: 15000 }
  ].map((plan, index) => ({
    id: createId('plan'),
    deviceId,
    scope: 'device',
    ...plan,
    currency: 'INR',
    enabled: true,
    displayOrder: index,
    createdAt: timestamp,
    updatedAt: timestamp,
    syncStatus: 'pending'
  }));
}

function normalizePlan(
  input: PlayPlanInput,
  currentDeviceId: string,
  existing?: PlayPlanRecord,
  touchUpdatedAt = true
): PlayPlanRecord {
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
  const scope = input.scope ?? existing?.scope ?? 'device';
  return {
    id: input.id ?? existing?.id ?? createId('plan'),
    deviceId: scope === 'device' ? currentDeviceId : undefined,
    scope,
    name,
    durationMinutes,
    amountPaise,
    currency,
    enabled: input.enabled ?? existing?.enabled ?? true,
    displayOrder: Number.isInteger(input.displayOrder)
      ? Number(input.displayOrder)
      : existing?.displayOrder ?? 0,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: touchUpdatedAt ? timestamp : existing?.updatedAt ?? timestamp,
    syncedAt: existing?.syncedAt,
    deletedAt: existing?.deletedAt,
    syncStatus: touchUpdatedAt ? 'pending' : existing?.syncStatus ?? 'pending'
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

function normalizeGame(
  input: GameInput,
  currentDeviceId: string,
  existing?: GameRecord,
  touchUpdatedAt = true
): GameRecord {
  const timestamp = nowIso();
  const enabled = input.enabled ?? existing?.enabled ?? true;
  const availabilityStatus = enabled ? input.availabilityStatus ?? existing?.availabilityStatus ?? 'unknown' : 'disabled';

  return {
    id: input.id ?? existing?.id ?? createId('game'),
    deviceId: currentDeviceId,
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
    updatedAt: touchUpdatedAt ? timestamp : existing?.updatedAt ?? timestamp,
    syncedAt: existing?.syncedAt,
    deletedAt: existing?.deletedAt,
    syncStatus: touchUpdatedAt ? 'pending' : existing?.syncStatus ?? 'pending'
  };
}

export class DataStore {
  private databasePath = join(app.getPath('userData'), 'nxgs-play-data.json');
  private data: AppDatabase | null = null;
  private persistQueue: Promise<void> = Promise.resolve();

  get path(): string {
    return this.databasePath;
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.databasePath), { recursive: true });

    if (!existsSync(this.databasePath)) {
      const device = createDefaultDevice();
      this.data = {
        schemaVersion: SCHEMA_VERSION,
        currentDeviceId: device.id,
        devices: [device],
        settings: DEFAULT_SETTINGS,
        games: [],
        plans: createDefaultPlans(device.id),
        sessions: [],
        cloud: normalizeCloudState(undefined)
      };
      await this.persist();
      return;
    }

    const raw = await readFile(this.databasePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppDatabase>;
    const devices = (parsed.devices ?? []).flatMap((device) => {
      try {
        return device.deletedAt ? [] : [normalizeDevice(device, device, false)];
      } catch {
        return [];
      }
    });
    const fallbackDevice = devices[0] ?? createDefaultDevice();
    if (devices.length === 0) devices.push(fallbackDevice);
    const currentDevice = devices.find((device) => device.id === parsed.currentDeviceId) ?? fallbackDevice;
    const migrationTimestamp = nowIso();
    const plans = (parsed.plans ?? []).flatMap((plan) => {
      try {
        const migratedPlan = {
          ...plan,
          scope: plan.scope ?? 'device'
        } as PlayPlanInput;
        return [normalizePlan(migratedPlan, plan.deviceId || currentDevice.id, plan, false)];
      } catch {
        return [];
      }
    });
    this.data = {
      schemaVersion: SCHEMA_VERSION,
      currentDeviceId: currentDevice.id,
      devices,
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
        },
        branding: {
          ...DEFAULT_SETTINGS.branding,
          ...(parsed.settings?.branding ?? {})
        }
      },
      games: (parsed.games ?? []).map((game) => {
        const legacyCover = game.coverImagePath ?? '';
        const avatarImagePath = game.avatarImagePath ?? legacyCover;
        return normalizeGame({
          ...game,
          avatarImagePath,
          coverImagePath: legacyCover || avatarImagePath,
          launchMode: game.launchMode ?? 'borderlessPreferred'
        }, game.deviceId || currentDevice.id, game, false);
      }),
      plans: plans.length > 0 || Number(parsed.schemaVersion) >= 4 ? plans : createDefaultPlans(currentDevice.id),
      sessions: (parsed.sessions ?? []).flatMap((session) => {
        if (!session.id || !Number.isFinite(Number(session.durationMinutes))) return [];
        const wasActive = session.status === 'active';
        // The app stopped mid-session: games could not outlive the paid time.
        const gamesClosedAt = wasActive
          ? [migrationTimestamp, session.expiresAt].filter((value) => Number.isFinite(Date.parse(value)))
            .sort((left, right) => Date.parse(left) - Date.parse(right))[0]
          : undefined;
        return [{
          ...session,
          deviceId: session.deviceId || currentDevice.id,
          status: wasActive ? 'interrupted' : session.status,
          planIds: Array.isArray(session.planIds) ? session.planIds : [],
          checkoutIds: Array.isArray(session.checkoutIds) ? session.checkoutIds : [],
          games: normalizeSessionGames(session.games, gamesClosedAt),
          payers: normalizePayerList(session.payers),
          amountPaise: Number(session.amountPaise) || 0,
          currency: session.currency || 'INR',
          endedAt: wasActive ? migrationTimestamp : session.endedAt,
          updatedAt: wasActive ? migrationTimestamp : session.updatedAt || migrationTimestamp,
          syncStatus: wasActive ? 'pending' : session.syncStatus || 'pending'
        } as LocalSessionRecord];
      }),
      cloud: normalizeCloudState(parsed.cloud)
    };
    await this.persist();
  }

  listGames(): GameRecord[] {
    const data = this.requireData();
    return structuredClone(data.games)
      .filter((game) => game.deviceId === data.currentDeviceId && !game.deletedAt)
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  getGame(id: string): GameRecord | undefined {
    const data = this.requireData();
    const game = data.games.find((item) => item.id === id && item.deviceId === data.currentDeviceId && !item.deletedAt);
    return game ? structuredClone(game) : undefined;
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
    if (existing && (existing.deviceId !== data.currentDeviceId || existing.deletedAt)) {
      throw new Error('Game does not belong to this device.');
    }
    const game = normalizeGame(input, data.currentDeviceId, existing);

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
    const game = data.games.find((item) => item.id === id && item.deviceId === data.currentDeviceId && !item.deletedAt);
    if (!game) throw new Error('Game not found on this device.');
    game.deletedAt = nowIso();
    game.updatedAt = game.deletedAt;
    game.syncStatus = 'pending';
    await this.persist();
  }

  getCurrentDevice(): DeviceRecord {
    const data = this.requireData();
    const device = data.devices.find((item) => item.id === data.currentDeviceId && !item.deletedAt);
    if (!device) throw new Error('Current device is not configured.');
    return structuredClone(device);
  }

  getDeviceManagerSummary(): DeviceManagerSummary {
    const device = this.getCurrentDevice();
    const plans = this.listPlans();
    const sessions = this.requireData().sessions.filter((session) =>
      session.deviceId === device.id && !session.deletedAt
    );
    const currentSession = [...sessions].reverse().find((session) => session.status === 'active');
    return {
      device,
      gameCount: this.listGames().length,
      activePlanCount: plans.filter((plan) => plan.enabled).length,
      totalPlanCount: plans.length,
      totalSessions: sessions.length,
      totalRevenuePaise: sessions.reduce((sum, session) => sum + session.amountPaise, 0),
      currentSessionStatus: currentSession?.status ?? 'idle'
    };
  }

  async updateCurrentDevice(input: DeviceInput): Promise<DeviceManagerSummary> {
    const data = this.requireData();
    const index = data.devices.findIndex((item) => item.id === data.currentDeviceId && !item.deletedAt);
    if (index < 0) throw new Error('Current device is not configured.');
    data.devices[index] = normalizeDevice(input, data.devices[index]);
    await this.persist();
    return this.getDeviceManagerSummary();
  }

  async recordPaidSession(
    entitlement: {
      checkoutId: string;
      durationMinutes: number;
      planId?: string;
      amountPaise?: number;
      currency?: string;
      payer?: PaymentPayerDetails;
    },
    expiresAt: string,
    extending: boolean,
    runningGames: SessionGameSource[] = []
  ): Promise<LocalSessionRecord> {
    const data = this.requireData();
    const timestamp = nowIso();
    const payer = normalizePayerDetails(entitlement.payer, entitlement.checkoutId);
    const active = extending ? this.findActiveSession() : undefined;
    if (active) {
      active.durationMinutes += entitlement.durationMinutes;
      active.amountPaise += Number(entitlement.amountPaise) || 0;
      active.expiresAt = expiresAt;
      active.updatedAt = timestamp;
      active.syncStatus = 'pending';
      if (entitlement.planId && !active.planIds.includes(entitlement.planId)) active.planIds.push(entitlement.planId);
      if (!active.checkoutIds.includes(entitlement.checkoutId)) active.checkoutIds.push(entitlement.checkoutId);
      if (payer) upsertPayer(active.payers, payer);
      await this.persist();
      return structuredClone(active);
    }

    // A game already open when the session starts is part of this session too.
    const games = [...new Map(runningGames.map((game) => [game.id, game])).values()]
      .map((game) => ({ gameId: game.id, title: game.title, startedAt: timestamp }));
    const session: LocalSessionRecord = {
      id: createId('session'),
      deviceId: data.currentDeviceId,
      status: 'active',
      planIds: entitlement.planId ? [entitlement.planId] : [],
      checkoutIds: [entitlement.checkoutId],
      games,
      payers: payer ? [payer] : [],
      durationMinutes: entitlement.durationMinutes,
      amountPaise: Number(entitlement.amountPaise) || 0,
      currency: entitlement.currency || 'INR',
      startedAt: timestamp,
      expiresAt,
      createdAt: timestamp,
      updatedAt: timestamp,
      syncStatus: 'pending'
    };
    data.sessions.push(session);
    await this.persist();
    return structuredClone(session);
  }

  async finishActiveSession(status: 'completed' | 'expired' | 'interrupted'): Promise<void> {
    const session = this.findActiveSession();
    if (!session) return;
    const timestamp = nowIso();
    session.status = status;
    session.endedAt = timestamp;
    for (const entry of session.games) entry.endedAt ??= timestamp;
    session.updatedAt = timestamp;
    session.syncStatus = 'pending';
    await this.persist();
  }

  /**
   * Notes a game launched during the active paid session. A game that already
   * has an open entry (resumed or relaunched while tracked) is not added twice.
   * Returns true when the session changed.
   */
  async recordSessionGameStart(game: SessionGameSource): Promise<boolean> {
    const session = this.findActiveSession();
    if (!session || !game.id) return false;
    if (session.games.some((entry) => entry.gameId === game.id && !entry.endedAt)) return false;
    const timestamp = nowIso();
    session.games.push({ gameId: game.id, title: game.title, startedAt: timestamp });
    session.updatedAt = timestamp;
    session.syncStatus = 'pending';
    await this.persist();
    return true;
  }

  /** Closes open game entries of the active session whose game is no longer running. Returns true when any closed. */
  async recordSessionGameEnd(runningGameIds: string[]): Promise<boolean> {
    const session = this.findActiveSession();
    if (!session) return false;
    const running = new Set(runningGameIds);
    const timestamp = nowIso();
    let changed = false;
    for (const entry of session.games) {
      if (entry.endedAt || running.has(entry.gameId)) continue;
      entry.endedAt = timestamp;
      changed = true;
    }
    if (!changed) return false;
    session.updatedAt = timestamp;
    session.syncStatus = 'pending';
    await this.persist();
    return true;
  }

  /** Plan names for earnings; soft-deleted plans keep their name, unknown IDs fall back to the ID. */
  resolvePlanNames(planIds: string[]): string[] {
    const plans = this.requireData().plans;
    return planIds.map((id) => plans.find((plan) => plan.id === id)?.name || id);
  }

  /** This device's paid sessions for the Accounts tab, filtered on `startedAt` (`from` inclusive, `to` exclusive). */
  listEarningsRows(query: Pick<EarningsQuery, 'from' | 'to'> = {}): EarningsSessionRow[] {
    const device = this.getCurrentDevice();
    return this.listSessionsInRange(query).map((session) => ({
      id: session.id,
      stationId: device.id,
      stationName: device.name,
      status: session.status,
      startedAt: session.startedAt,
      ...(session.endedAt ? { endedAt: session.endedAt } : {}),
      expiresAt: session.expiresAt,
      durationMinutes: session.durationMinutes,
      amountPaise: session.amountPaise,
      currency: session.currency,
      planNames: this.resolvePlanNames(session.planIds),
      checkoutIds: [...session.checkoutIds],
      games: structuredClone(session.games),
      payers: structuredClone(session.payers)
    }));
  }

  /** Checkout IDs in the range whose Razorpay payer details are not stored locally yet. */
  listCheckoutIdsMissingPayers(query: Pick<EarningsQuery, 'from' | 'to'> = {}, limit = 200): string[] {
    const missing = new Set<string>();
    for (const session of this.listSessionsInRange(query)) {
      for (const checkoutId of session.checkoutIds) {
        if (!session.payers.some((payer) => payer.checkoutId === checkoutId)) missing.add(checkoutId);
      }
    }
    return [...missing].slice(0, limit);
  }

  /** Stores payer details fetched from the cloud. They are not uploaded, so sessions are not marked dirty. */
  async applySessionPayers(payers: PaymentPayerDetails[]): Promise<boolean> {
    const data = this.requireData();
    let changed = false;
    for (const payer of payers) {
      // The cloud returns checkout UUIDs lowercased; keep this session's spelling.
      const key = payer.checkoutId.toLowerCase();
      for (const session of data.sessions) {
        if (session.deviceId !== data.currentDeviceId) continue;
        const checkoutId = session.checkoutIds.find((id) => id.toLowerCase() === key);
        if (!checkoutId) continue;
        changed = upsertPayer(session.payers, { ...structuredClone(payer), checkoutId }) || changed;
      }
    }
    if (changed) await this.persist();
    return changed;
  }

  // -------------------------------------------------------------------------
  // Device Management cloud sync
  // -------------------------------------------------------------------------

  getCloudState(): StationCloudState {
    return structuredClone(this.requireData().cloud);
  }

  async updateCloudState(patch: Partial<StationCloudState>): Promise<StationCloudState> {
    const data = this.requireData();
    const next = normalizeCloudState({ ...data.cloud, ...patch });
    if (JSON.stringify(next) !== JSON.stringify(data.cloud)) {
      data.cloud = next;
      await this.persist();
    }
    return this.getCloudState();
  }

  /** Sessions to upload, oldest first. A session the cloud rejected waits until it changes again. */
  listPendingSyncSessions(limit = 200): LocalSessionRecord[] {
    return this.pendingSyncSessions()
      .filter((session) => session.syncStatus !== 'error')
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
      .slice(0, Math.max(0, limit))
      .map((session) => structuredClone(session));
  }

  countPendingSyncSessions(): number {
    return this.pendingSyncSessions().length;
  }

  /** Marks sessions synced, skipping any that changed after they were sent. */
  async markSessionsSynced(entries: Array<{ id: string; updatedAt: string }>, syncedAt = nowIso()): Promise<number> {
    const data = this.requireData();
    let marked = 0;
    for (const entry of entries) {
      const session = data.sessions.find((item) => item.id === entry.id && item.deviceId === data.currentDeviceId);
      if (!session || session.updatedAt !== entry.updatedAt || session.syncStatus === 'synced') continue;
      session.syncStatus = 'synced';
      session.syncedAt = syncedAt;
      marked += 1;
    }
    if (marked > 0) await this.persist();
    return marked;
  }

  /** Parks a session the cloud rejected as invalid so it cannot block every later sync. */
  async markSessionSyncError(id: string, updatedAt: string): Promise<boolean> {
    const data = this.requireData();
    const session = data.sessions.find((item) => item.id === id && item.deviceId === data.currentDeviceId);
    if (!session || session.updatedAt !== updatedAt || session.syncStatus === 'error') return false;
    session.syncStatus = 'error';
    await this.persist();
    return true;
  }

  /** Marks games synced when they have not changed since the snapshot that was sent, and stamps the sync time. */
  async markStationSynced(
    snapshot: { games: Array<{ id: string; updatedAt: string }> },
    syncedAt = nowIso()
  ): Promise<void> {
    const data = this.requireData();
    const device = data.devices.find((item) => item.id === data.currentDeviceId && !item.deletedAt);
    if (device) device.lastSyncedAt = syncedAt;
    for (const entry of snapshot.games) {
      const game = data.games.find((item) => item.id === entry.id && item.deviceId === data.currentDeviceId);
      if (!game || game.updatedAt !== entry.updatedAt) continue;
      game.syncStatus = 'synced';
      game.syncedAt = syncedAt;
    }
    await this.persist();
  }

  /**
   * Reconciles the device record with the values the cloud keeps for it,
   * without comparing clocks: equal values mark the device synced; different
   * values are adopted (synced, not dirty) only when the device has not been
   * edited since `sentUpdatedAt`, otherwise the local edit syncs next time.
   * Returns true when cloud values were adopted.
   */
  async reconcileCloudDevice(fields: OwnerDeviceFields, sentUpdatedAt: string, syncedAt = nowIso()): Promise<boolean> {
    return this.writeCloudDevice(fields, syncedAt, (device) => device.updatedAt === sentUpdatedAt);
  }

  /** Adopts device details the main admin just saved for this PC. Returns true when a field changed. */
  async applyCloudDeviceFields(fields: OwnerDeviceFields, syncedAt = nowIso()): Promise<boolean> {
    return this.writeCloudDevice(fields, syncedAt, () => true);
  }

  /**
   * Applies games the main admin turned on or off remotely: the owner wins
   * while an override is pending. Bumping `updatedAt` re-uploads the game so
   * the cloud sees the applied value and clears the override.
   * Returns the number of games whose `enabled` flag changed.
   */
  async applyGameOverrides(overrides: GameOverride[]): Promise<number> {
    const data = this.requireData();
    const timestamp = nowIso();
    let applied = 0;
    let changed = 0;
    for (const override of overrides) {
      const game = data.games.find((item) =>
        item.id === override.gameId && item.deviceId === data.currentDeviceId && !item.deletedAt
      );
      if (!game) continue;
      const enabled = Boolean(override.enabled);
      if (game.enabled !== enabled) changed += 1;
      game.enabled = enabled;
      // Same rule as normalizeGame: disabled games read as disabled; a
      // re-enabled game no longer is, but its real availability is unknown.
      game.availabilityStatus = enabled
        ? game.availabilityStatus === 'disabled' ? 'unknown' : game.availabilityStatus
        : 'disabled';
      game.updatedAt = timestamp;
      game.syncStatus = 'pending';
      applied += 1;
    }
    if (applied > 0) await this.persist();
    return changed;
  }

  /** Replaces the moderator PINs this station accepts. Returns true when the list changed. */
  async setModeratorCredentials(moderators: CachedModeratorCredential[]): Promise<boolean> {
    const data = this.requireData();
    const next = normalizeCloudState({ ...data.cloud, moderators }).moderators;
    if (JSON.stringify(next) === JSON.stringify(data.cloud.moderators)) return false;
    data.cloud.moderators = next;
    await this.persist();
    return true;
  }

  listPlans(enabledOnly = false): PlayPlanRecord[] {
    const data = this.requireData();
    return structuredClone(data.plans)
      .filter((plan) => !plan.deletedAt && (plan.scope === 'global' || plan.deviceId === data.currentDeviceId))
      .filter((plan) => !enabledOnly || plan.enabled)
      .sort((a, b) => a.displayOrder - b.displayOrder || a.createdAt.localeCompare(b.createdAt));
  }

  getPlan(id: string): PlayPlanRecord | undefined {
    const data = this.requireData();
    const plan = data.plans.find((item) =>
      item.id === id && !item.deletedAt && (item.scope === 'global' || item.deviceId === data.currentDeviceId)
    );
    return plan ? structuredClone(plan) : undefined;
  }

  async savePlan(input: PlayPlanInput): Promise<PlayPlanRecord> {
    const data = this.requireData();
    const existingIndex = input.id ? data.plans.findIndex((plan) => plan.id === input.id) : -1;
    const existing = existingIndex >= 0 ? data.plans[existingIndex] : undefined;
    if (input.id && (!existing || existing.deletedAt || (existing.scope !== 'global' && existing.deviceId !== data.currentDeviceId))) {
      throw new Error('Plan not found for this device.');
    }
    const visiblePlans = this.listPlans();
    const nextOrder = visiblePlans.reduce((maximum, plan) => Math.max(maximum, plan.displayOrder), -1) + 1;
    const plan = normalizePlan(
      { ...input, displayOrder: input.displayOrder ?? existing?.displayOrder ?? nextOrder },
      data.currentDeviceId,
      existing
    );
    if (existingIndex >= 0) data.plans[existingIndex] = plan;
    else data.plans.push(plan);
    await this.persist();
    return structuredClone(plan);
  }

  async deletePlan(id: string): Promise<void> {
    const data = this.requireData();
    const plan = data.plans.find((item) =>
      item.id === id && !item.deletedAt && (item.scope === 'global' || item.deviceId === data.currentDeviceId)
    );
    if (!plan) throw new Error('Plan not found for this device.');
    plan.deletedAt = nowIso();
    plan.updatedAt = plan.deletedAt;
    plan.syncStatus = 'pending';
    this.normalizePlanOrder(data.plans.filter((item) =>
      !item.deletedAt && (item.scope === 'global' || item.deviceId === data.currentDeviceId)
    ));
    await this.persist();
  }

  async setPlanEnabled(id: string, enabled: boolean): Promise<PlayPlanRecord> {
    const existing = this.getPlan(id);
    if (!existing) throw new Error('Plan not found.');
    return this.savePlan({ ...existing, enabled });
  }

  async reorderPlans(orderedIds: string[]): Promise<PlayPlanRecord[]> {
    const data = this.requireData();
    const visiblePlans = data.plans.filter((plan) =>
      !plan.deletedAt && (plan.scope === 'global' || plan.deviceId === data.currentDeviceId)
    );
    if (orderedIds.length !== visiblePlans.length || new Set(orderedIds).size !== visiblePlans.length) {
      throw new Error('Plan order is incomplete.');
    }
    const byId = new Map(visiblePlans.map((plan) => [plan.id, plan]));
    if (orderedIds.some((id) => !byId.has(id))) throw new Error('Plan order contains an unknown plan.');
    this.normalizePlanOrder(orderedIds.map((id) => byId.get(id)!));
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
      playAccessMode: settings.playAccessMode === 'free' ? 'free' : 'paid',
      sessionDurationsMinutes: durations.length > 0 ? durations : DEFAULT_SETTINGS.sessionDurationsMinutes,
      branding: {
        logoPath: settings.branding?.logoPath?.trim() ?? data.settings.branding.logoPath
      },
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

  /** Every PIN prompt accepts the local admin PIN or a moderator PIN cached from Device Management. */
  verifyPin(pin: string): boolean {
    return this.identifyPin(pin).ok;
  }

  identifyPin(pin: string): PinIdentity {
    if (typeof pin !== 'string' || !pin) return { ok: false };
    const data = this.requireData();
    if (data.settings.adminPin === pin) return { ok: true, role: 'admin' };
    // A PC removed from Device Management no longer honours moderator PINs.
    if (!isValidPin(pin) || data.cloud.removedByOwner) return { ok: false };
    const moderator = data.cloud.moderators.find((item) => verifyPinHash(pin, item.pinHash));
    return moderator ? { ok: true, role: 'moderator', moderatorName: moderator.name } : { ok: false };
  }

  private requireData(): AppDatabase {
    if (!this.data) {
      throw new Error('Data store has not been initialized.');
    }
    return this.data;
  }

  private async writeCloudDevice(
    fields: OwnerDeviceFields,
    syncedAt: string,
    mayAdopt: (device: DeviceRecord) => boolean
  ): Promise<boolean> {
    const data = this.requireData();
    const index = data.devices.findIndex((item) => item.id === data.currentDeviceId && !item.deletedAt);
    if (index < 0) throw new Error('Current device is not configured.');
    const existing = data.devices[index];
    // Validates and trims the cloud values exactly like a local edit.
    const cloud = normalizeDevice({
      ...existing,
      name: fields.name,
      storeName: fields.storeName ?? '',
      location: fields.location ?? '',
      status: fields.status
    }, existing, false);
    const same = cloud.name === existing.name && cloud.storeName === existing.storeName
      && cloud.location === existing.location && cloud.status === existing.status;
    const adopt = !same && mayAdopt(existing);
    data.devices[index] = adopt
      ? { ...cloud, updatedAt: nowIso(), lastSyncedAt: syncedAt, syncedAt, syncStatus: 'synced' }
      : same
        ? { ...existing, lastSyncedAt: syncedAt, syncedAt, syncStatus: 'synced' }
        : { ...existing, lastSyncedAt: syncedAt };
    await this.persist();
    return adopt;
  }

  private findActiveSession(): LocalSessionRecord | undefined {
    const data = this.requireData();
    return [...data.sessions].reverse().find((session) =>
      session.deviceId === data.currentDeviceId && session.status === 'active' && !session.deletedAt
    );
  }

  private listSessionsInRange(query: Pick<EarningsQuery, 'from' | 'to'>): LocalSessionRecord[] {
    const data = this.requireData();
    const from = query.from ? Date.parse(query.from) : Number.NaN;
    const to = query.to ? Date.parse(query.to) : Number.NaN;
    return data.sessions.filter((session) => {
      if (session.deviceId !== data.currentDeviceId || session.deletedAt) return false;
      const startedAt = Date.parse(session.startedAt);
      if (Number.isFinite(from) && !(startedAt >= from)) return false;
      if (Number.isFinite(to) && !(startedAt < to)) return false;
      return true;
    });
  }

  private pendingSyncSessions(): LocalSessionRecord[] {
    const data = this.requireData();
    return data.sessions.filter((session) =>
      session.deviceId === data.currentDeviceId && !session.deletedAt && session.syncStatus !== 'synced'
    );
  }

  private normalizePlanOrder(plans: PlayPlanRecord[]): void {
    plans.forEach((plan, index) => {
      plan.displayOrder = index;
      plan.updatedAt = nowIso();
      plan.syncStatus = 'pending';
    });
  }

  // Background sync and game tracking also write, so writes are serialised:
  // overlapping writes of the shared temp file could fail the rename.
  private persist(): Promise<void> {
    const write = this.persistQueue.catch(() => undefined).then(() => this.writeSnapshot());
    this.persistQueue = write;
    return write;
  }

  private async writeSnapshot(): Promise<void> {
    const data = this.requireData();
    const tempPath = `${this.databasePath}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await rename(tempPath, this.databasePath);
  }
}
