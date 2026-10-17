import { net } from 'electron';
import { randomBytes } from 'node:crypto';
import type {
  AvailabilityStatus,
  DeviceRecord,
  EarningsQuery,
  EarningsReport,
  EarningsSessionRow,
  FleetErrorCode,
  FleetLocalDataChange,
  FleetResult,
  FleetStation,
  FleetStationDetail,
  FleetStationGame,
  FleetStationInput,
  FleetSyncStatus,
  GameRecord,
  LaunchType,
  LocalSessionRecord,
  LocalSessionStatus,
  ModeratorInput,
  ModeratorRecord,
  OwnerSessionState,
  OwnerUnlockResult,
  SessionGamePlay
} from '../shared/types';
import { buildEarningsReport, normalizePayerList } from '../shared/earnings';
import { readBackendConfig, type BackendConfig } from './backendConfig';
import type { DataStore, GameOverride, OwnerDeviceFields } from './database';
import { logLine } from './logger';
import { isValidPin } from './pinHash';

// Device Management: keeps this station in sync with the `stationFleet` edge
// function and runs the main admin's (owner's) cloud calls. The station token
// lives in the local database; the owner token only in memory. Nothing here
// throws into callers: failures become FleetResult codes and log lines.

const REQUEST_TIMEOUT_MS = 20_000;
const PAYER_LOOKUP_TIMEOUT_MS = 8_000;
const PAYER_RETRY_MS = 2 * 60_000;
const FIRST_SYNC_DELAY_MS = 15_000;
const SYNC_INTERVAL_MS = 5 * 60_000;
const CHANGE_DEBOUNCE_MS = 3_000;
const SESSION_BATCH = 200;
// The cloud slides the owner session 30 minutes on every authorised call.
const OWNER_SESSION_MS = 30 * 60_000;
const STATION_ID = /^[A-Za-z0-9_-]{3,80}$/;

const MESSAGES = {
  offline: 'No internet connection. Device Management needs the cloud.',
  timeout: "The cloud didn't respond in time. Check the internet connection and try again.",
  notConfigured: "Device Management isn't set up on this PC: nxgs-client.ini has no cloud backend.",
  notDeployed: "Device Management isn't available yet: its cloud service hasn't been deployed.",
  ownerPinRequired: 'Enter the main admin PIN to continue.',
  invalidOwnerPin: 'Wrong main admin PIN.',
  ownerLocked: 'Too many wrong PINs. Try again in 10 minutes.',
  notFound: 'That station or moderator no longer exists. Refresh and try again.',
  invalidInput: 'Check the details and try again.',
  serverError: 'The cloud service had a problem. Try again in a moment.',
  failed: 'Device Management is unavailable right now. Try again in a moment.',
  unauthorizedClient: "The cloud rejected this PC's app key. Check nxgs-client.ini.",
  stationRemoved: 'This PC was removed from Device Management by the main admin. Rejoin it from All Devices to sync again.',
  stationAlreadyRegistered:
    'This PC is registered in Device Management under a different key. The main admin must rejoin it from this PC (All Devices).',
  unauthorizedStation:
    "This PC's cloud key is no longer valid. The main admin must rejoin it from this PC (All Devices).",
  controlRoomClosed: 'The Control Room was closed.'
} as const;

const KNOWN_WIRE_CODES = new Set([
  'unauthorized_client',
  'unauthorized_station',
  'station_removed',
  'station_already_registered',
  'owner_pin_required',
  'invalid_owner_pin',
  'owner_locked',
  'not_found',
  'invalid_input',
  'request_failed'
]);

const LAUNCH_TYPES = new Set<LaunchType>(['steam', 'epic', 'microsoftStore', 'localExe', 'custom']);
const AVAILABILITY = new Set<AvailabilityStatus>(['available', 'missing', 'disabled', 'unknown']);
const SESSION_STATUSES = new Set<LocalSessionStatus>(['active', 'completed', 'expired', 'interrupted']);

type WireObject = Record<string, unknown>;

/** A failed cloud call. `code` is a stationFleet error code or a local one (offline, timeout, not_configured, not_deployed, bad_response). */
class FleetCallError extends Error {
  readonly code: string;
  readonly status: number;
  readonly body: WireObject;

  constructor(code: string, message: string, status = 0, body: WireObject = {}) {
    super(message);
    this.name = 'FleetCallError';
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

function asCallError(error: unknown): FleetCallError {
  return error instanceof FleetCallError
    ? error
    : new FleetCallError('bad_response', error instanceof Error ? error.message : String(error));
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalStr(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function obj(value: unknown): WireObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as WireObject : undefined;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function strings(value: unknown): string[] {
  return list(value).filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function isConfigured(config: BackendConfig | null | undefined): config is BackendConfig {
  return Boolean(config?.functionBaseUrl && config.publishableKey);
}

function clockTime(iso: string | undefined): string {
  const time = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(time)) return '';
  const date = new Date(time);
  const hours = date.getHours();
  return `${hours % 12 || 12}:${String(date.getMinutes()).padStart(2, '0')} ${hours < 12 ? 'am' : 'pm'}`;
}

function failureCode(error: FleetCallError): FleetErrorCode {
  switch (error.code) {
    case 'offline':
    case 'timeout':
      return 'offline';
    case 'not_configured':
    case 'not_deployed':
    case 'owner_pin_required':
    case 'invalid_owner_pin':
    case 'owner_locked':
    case 'not_found':
    case 'invalid_input':
      return error.code;
    default:
      return 'failed';
  }
}

// `invalid_input` names the rejected field; say what to fix where staff can act on it.
const INVALID_FIELD_MESSAGES: Record<string, string> = {
  name: 'Check the name and try again.',
  store_name: 'Check the store or branch name and try again.',
  location: 'Check the location and try again.',
  status: 'Choose active or inactive.',
  pin: 'PINs are 4 to 12 digits.',
  current_pin: 'PINs are 4 to 12 digits.',
  next_pin: 'PINs are 4 to 12 digits.',
  station_ids: 'A selected station no longer exists or was removed. Refresh and try again.',
  station_id: 'That station no longer exists. Refresh and try again.',
  from: 'Choose a valid date range.',
  to: 'Choose a valid date range.'
};

function invalidInputMessage(detail: string): string {
  const field = detail.replace(/^station\./, '').replace(/\[\d+\].*$/, '');
  if (INVALID_FIELD_MESSAGES[field]) return INVALID_FIELD_MESSAGES[field];
  return detail && detail.length <= 80 ? `Check the details and try again (${detail}).` : MESSAGES.invalidInput;
}

function failureMessage(error: FleetCallError): string {
  switch (error.code) {
    case 'offline': return MESSAGES.offline;
    case 'timeout': return MESSAGES.timeout;
    case 'not_configured': return MESSAGES.notConfigured;
    case 'not_deployed': return MESSAGES.notDeployed;
    case 'owner_pin_required': return MESSAGES.ownerPinRequired;
    case 'invalid_owner_pin': return MESSAGES.invalidOwnerPin;
    case 'owner_locked': {
      const time = clockTime(str(error.body.locked_until));
      return time ? `Too many wrong PINs. Try again after ${time}.` : MESSAGES.ownerLocked;
    }
    case 'not_found': return MESSAGES.notFound;
    case 'invalid_input': return invalidInputMessage(str(error.body.detail).trim());
    case 'unauthorized_client': return MESSAGES.unauthorizedClient;
    case 'unauthorized_station': return MESSAGES.unauthorizedStation;
    case 'station_removed': return MESSAGES.stationRemoved;
    case 'station_already_registered': return MESSAGES.stationAlreadyRegistered;
    case 'request_failed': return MESSAGES.serverError;
    default: return MESSAGES.failed;
  }
}

function failure<T>(error: FleetCallError): FleetResult<T> {
  return { ok: false, code: failureCode(error), error: failureMessage(error) };
}

function invalidInput<T>(error: string): FleetResult<T> {
  return { ok: false, code: 'invalid_input', error };
}

// ---------------------------------------------------------------------------
// Wire <-> app shapes
// ---------------------------------------------------------------------------

function toFleetStation(wire: WireObject, currentDeviceId: string): FleetStation {
  const id = str(wire.id);
  return {
    id,
    name: str(wire.name) || id,
    storeName: str(wire.store_name),
    location: str(wire.location),
    status: wire.status === 'inactive' ? 'inactive' : 'active',
    appVersion: str(wire.app_version),
    registeredAt: str(wire.registered_at),
    lastSeenAt: optionalStr(wire.last_seen_at),
    removedAt: optionalStr(wire.removed_at),
    gameCount: num(wire.game_count),
    sessionCount: num(wire.session_count),
    totalRevenuePaise: num(wire.total_revenue_paise),
    isCurrentDevice: id === currentDeviceId
  };
}

function toFleetGame(wire: WireObject): FleetStationGame {
  const id = str(wire.game_id);
  return {
    id,
    title: str(wire.title) || id,
    enabled: wire.enabled !== false,
    launchType: LAUNCH_TYPES.has(wire.launch_type as LaunchType) ? wire.launch_type as LaunchType : 'custom',
    source: str(wire.source),
    availabilityStatus: AVAILABILITY.has(wire.availability_status as AvailabilityStatus)
      ? wire.availability_status as AvailabilityStatus
      : 'unknown',
    updatedAt: str(wire.local_updated_at) || str(wire.owner_updated_at),
    // An override is pending until the station reports the owner's value.
    pendingOwnerChange: typeof wire.owner_enabled === 'boolean'
  };
}

function toModerator(wire: WireObject): ModeratorRecord {
  return {
    id: str(wire.id),
    name: str(wire.name),
    stationIds: strings(wire.station_ids),
    active: wire.active !== false,
    createdAt: str(wire.created_at),
    updatedAt: str(wire.updated_at)
  };
}

function toSessionGames(value: unknown): SessionGamePlay[] {
  return list(value).flatMap((entry) => {
    const game = obj(entry);
    const gameId = str(game?.game_id);
    const startedAt = str(game?.started_at);
    if (!game || !gameId || !startedAt) return [];
    const endedAt = optionalStr(game.ended_at);
    return [{ gameId, title: str(game.title) || gameId, startedAt, ...(endedAt ? { endedAt } : {}) }];
  });
}

function toEarningsRow(value: unknown): EarningsSessionRow[] {
  const wire = obj(value);
  const id = str(wire?.session_id);
  const stationId = str(wire?.station_id);
  if (!wire || !id || !stationId) return [];
  const planIds = strings(wire.plan_ids);
  const planNames = list(wire.plan_names).map((name, index) => str(name) || planIds[index] || '').filter(Boolean);
  const endedAt = optionalStr(wire.ended_at);
  const expiresAt = optionalStr(wire.expires_at);
  return [{
    id,
    stationId,
    stationName: str(wire.station_name) || stationId,
    status: SESSION_STATUSES.has(wire.status as LocalSessionStatus) ? wire.status as LocalSessionStatus : 'completed',
    startedAt: str(wire.started_at),
    ...(endedAt ? { endedAt } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    durationMinutes: num(wire.duration_minutes),
    amountPaise: num(wire.amount_paise),
    currency: str(wire.currency) || 'INR',
    planNames: planNames.length > 0 ? planNames : planIds,
    checkoutIds: strings(wire.checkout_ids),
    games: toSessionGames(wire.games),
    payers: normalizePayerList(wire.payers),
    paymentVerified: wire.payment_verified === true
  }];
}

// The cloud rejects a whole sync when one field is out of range, so payloads
// are clipped to its limits (200-character text, 50-entry lists, 200 plays).
function clip(value: string, max = 200): string {
  const trimmed = (value ?? '').trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function clipList(values: string[]): string[] {
  return values.slice(0, 50).map((value) => (value ?? '').slice(0, 200));
}

function wholeNumber(value: number, max: number): number {
  return Math.min(max, Math.max(0, Math.round(Number(value) || 0)));
}

function stationPayload(device: DeviceRecord, appVersion: string): WireObject {
  return {
    name: device.name,
    store_name: device.storeName,
    location: device.location,
    status: device.status,
    // Local edits not yet confirmed by the cloud; the cloud stores them unless
    // the main admin has an edit of its own pending. No clocks are compared.
    dirty: device.syncStatus !== 'synced',
    app_version: clip(appVersion, 40),
    local_updated_at: device.updatedAt
  };
}

function gamePayload(game: GameRecord): WireObject {
  return {
    game_id: game.id,
    title: clip(game.title),
    enabled: game.enabled,
    launch_type: clip(game.launchType, 40),
    source: clip(game.source),
    availability_status: clip(game.availabilityStatus, 40),
    local_updated_at: game.updatedAt
  };
}

function ownerDeviceFields(station: WireObject, current: DeviceRecord): OwnerDeviceFields {
  return {
    name: str(station.name).trim() || current.name,
    storeName: typeof station.store_name === 'string' ? station.store_name : current.storeName,
    location: typeof station.location === 'string' ? station.location : current.location,
    status: station.status === 'inactive' ? 'inactive' : station.status === 'active' ? 'active' : current.status
  };
}

function normalizeRange(query: EarningsQuery | undefined): { from?: string; to?: string } | null {
  const range: { from?: string; to?: string } = {};
  for (const key of ['from', 'to'] as const) {
    const value = query?.[key];
    if (value === undefined || value === null || value === '') continue;
    const time = Date.parse(String(value));
    if (!Number.isFinite(time)) return null;
    range[key] = new Date(time).toISOString();
  }
  return range;
}

function validateStationInput(input: FleetStationInput | undefined): OwnerDeviceFields | string {
  const name = str(input?.name).trim();
  const storeName = str(input?.storeName).trim();
  const location = str(input?.location).trim();
  if (!name) return 'Device name is required.';
  if (name.length > 80) return 'Device name must be 80 characters or fewer.';
  if (storeName.length > 120) return 'Store or branch name must be 120 characters or fewer.';
  if (location.length > 160) return 'Device location must be 160 characters or fewer.';
  return { name, storeName, location, status: input?.status === 'inactive' ? 'inactive' : 'active' };
}

export interface FleetServiceOptions {
  store: DataStore;
  appVersion: string;
  /** Called when a cloud change updated this station's device record or games. */
  onLocalDataChanged: (change: FleetLocalDataChange) => void;
}

export class FleetService {
  private readonly store: DataStore;
  private readonly appVersion: string;
  private readonly onLocalDataChanged: (change: FleetLocalDataChange) => void;
  private configPromise: Promise<BackendConfig> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private timerDueAt = 0;
  private inFlight: Promise<void> | null = null;
  private rerunRequested = false;
  private started = false;
  // The cloud knows this PC under another key (`station_already_registered`
  // or `unauthorized_station`): only the main admin's rejoin can fix it, so
  // automatic syncs stop until a manual sync or rejoin.
  private registrationBlocked = false;
  private acknowledgementFollowUps = 0;
  private lastLoggedSyncError: string | undefined;
  private readonly payerLookups = new Map<string, number>();
  private owner: { token: string; expiresAt: number } | null = null;
  // Bumped whenever the owner session is cleared, so an unlock that finishes
  // after the Control Room closed cannot revive it.
  private ownerGeneration = 0;

  constructor(options: FleetServiceOptions) {
    this.store = options.store;
    this.appVersion = options.appVersion;
    this.onLocalDataChanged = options.onLocalDataChanged;
  }

  /** Starts background sync: first run shortly after startup, then every five minutes. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.schedule(FIRST_SYNC_DELAY_MS);
  }

  stop(): void {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Debounced sync after a local change (paid session, game played, device or library edits). */
  requestSync(_reason: string): void {
    if (!this.started) return;
    if (this.inFlight) {
      this.rerunRequested = true;
      return;
    }
    this.schedule(CHANGE_DEBOUNCE_MS);
  }

  async syncNow(): Promise<FleetSyncStatus> {
    this.registrationBlocked = false;
    await this.syncFresh('manual');
    return this.status();
  }

  async status(): Promise<FleetSyncStatus> {
    const config = await this.config().catch(() => null);
    try {
      const cloud = this.store.getCloudState();
      return {
        configured: isConfigured(config),
        registered: Boolean(cloud.stationToken && cloud.registeredAt),
        syncing: Boolean(this.inFlight),
        removedByOwner: cloud.removedByOwner,
        needsRejoin: cloud.removedByOwner || this.registrationBlocked,
        lastSyncAt: cloud.lastSyncAt,
        lastSyncError: cloud.lastSyncError,
        pendingSessions: this.store.countPendingSyncSessions()
      };
    } catch {
      return {
        configured: isConfigured(config),
        registered: false,
        syncing: false,
        removedByOwner: false,
        needsRejoin: false,
        pendingSessions: 0
      };
    }
  }

  // -------------------------------------------------------------------------
  // Owner (main admin) session
  // -------------------------------------------------------------------------

  ownerSession(): OwnerSessionState {
    const owner = this.validOwner();
    return owner ? { unlocked: true, expiresAt: new Date(owner.expiresAt).toISOString() } : { unlocked: false };
  }

  async unlockOwner(pin: string): Promise<OwnerUnlockResult> {
    if (!isValidPin(pin)) return { ok: false, code: 'invalid_owner_pin', error: MESSAGES.invalidOwnerPin };
    const generation = this.ownerGeneration;
    try {
      const response = await this.invoke('owner_login', { pin });
      const token = str(response.owner_token);
      if (!token) throw new FleetCallError('bad_response', 'owner_login returned no owner token.');
      if (generation !== this.ownerGeneration) {
        // The Control Room closed while the PIN was being checked.
        void this.invoke('owner_logout', { owner_token: token }).catch(() => undefined);
        await logLine('info', 'Main admin unlock finished after the Control Room closed; the new session was revoked.');
        return { ok: false, code: 'owner_pin_required', error: MESSAGES.controlRoomClosed };
      }
      // Track expiry on this PC's clock; the cloud stays the authority.
      this.owner = { token, expiresAt: Date.now() + OWNER_SESSION_MS };
      await logLine('info', 'Main admin unlocked Device Management.');
      return { ok: true, expiresAt: new Date(this.owner.expiresAt).toISOString() };
    } catch (error) {
      const callError = asCallError(error);
      await logLine('warn', `Main admin unlock failed: ${callError.message}`);
      const result: OwnerUnlockResult = { ok: false, code: failureCode(callError), error: failureMessage(callError) };
      const lockedUntil = optionalStr(callError.body.locked_until);
      if (callError.code === 'owner_locked' && lockedUntil) result.lockedUntil = lockedUntil;
      return result;
    }
  }

  async lockOwner(): Promise<{ ok: boolean }> {
    this.clearOwnerSession('locked by staff');
    return { ok: true };
  }

  /** Forgets the owner token now and revokes it in the cloud in the background. */
  clearOwnerSession(reason: string): void {
    this.ownerGeneration += 1;
    const owner = this.owner;
    this.owner = null;
    if (!owner) return;
    void logLine('info', `Main admin Device Management session ended (${reason}).`);
    void this.invoke('owner_logout', { owner_token: owner.token }).catch((error) => {
      void logLine('info', `Main admin logout could not reach the cloud: ${asCallError(error).message}`);
    });
  }

  changeOwnerPin(currentPin: string, nextPin: string): Promise<FleetResult<{ changed: true }>> {
    if (!isValidPin(currentPin) || !isValidPin(nextPin)) {
      return Promise.resolve(invalidInput('The main admin PIN must be 4 to 12 digits.'));
    }
    return this.ownerCall('owner_change_pin', { current_pin: currentPin, next_pin: nextPin }, async () => {
      await logLine('info', 'Main admin PIN changed.');
      return { changed: true as const };
    });
  }

  // -------------------------------------------------------------------------
  // Owner fleet calls
  // -------------------------------------------------------------------------

  listStations(): Promise<FleetResult<FleetStation[]>> {
    return this.ownerCall('list_stations', {}, (response) => {
      const currentId = this.currentDeviceId();
      return list(response.stations).flatMap((station) => {
        const wire = obj(station);
        return wire && str(wire.id) ? [toFleetStation(wire, currentId)] : [];
      });
    });
  }

  getStation(stationId: string): Promise<FleetResult<FleetStationDetail>> {
    if (!STATION_ID.test(str(stationId))) return Promise.resolve(invalidInput('Unknown station.'));
    return this.ownerCall('get_station', { station_id: stationId }, (response) => {
      const station = obj(response.station);
      if (!station) throw new FleetCallError('bad_response', 'get_station returned no station.');
      return {
        station: toFleetStation(station, this.currentDeviceId()),
        games: list(response.games)
          .flatMap((game) => {
            const wire = obj(game);
            return wire && str(wire.game_id) ? [toFleetGame(wire)] : [];
          })
          .sort((left, right) => left.title.localeCompare(right.title)),
        moderators: list(response.moderators).flatMap((moderator) => {
          const wire = obj(moderator);
          return wire && str(wire.id) ? [toModerator(wire)] : [];
        })
      };
    });
  }

  updateStation(stationId: string, input: FleetStationInput): Promise<FleetResult<FleetStation>> {
    if (!STATION_ID.test(str(stationId))) return Promise.resolve(invalidInput('Unknown station.'));
    const fields = validateStationInput(input);
    if (typeof fields === 'string') return Promise.resolve(invalidInput(fields));
    return this.ownerCall('update_station', {
      station_id: stationId,
      name: fields.name,
      store_name: fields.storeName,
      location: fields.location,
      status: fields.status
    }, async (response) => {
      const station = obj(response.station);
      if (!station) throw new FleetCallError('bad_response', 'update_station returned no station.');
      const result = toFleetStation(station, this.currentDeviceId());
      if (result.isCurrentDevice) await this.applyOwnerDevice(station);
      return result;
    });
  }

  removeStation(stationId: string): Promise<FleetResult<{ removed: true }>> {
    if (!STATION_ID.test(str(stationId))) return Promise.resolve(invalidInput('Unknown station.'));
    return this.ownerCall('remove_station', { station_id: stationId }, async () => {
      await logLine('info', `Main admin removed station ${stationId} from Device Management.`);
      if (stationId === this.currentDeviceId()) await this.markRemovedByOwner();
      return { removed: true as const };
    });
  }

  setGameEnabled(stationId: string, gameId: string, enabled: boolean): Promise<FleetResult<FleetStationGame>> {
    if (!STATION_ID.test(str(stationId)) || !str(gameId)) return Promise.resolve(invalidInput('Unknown station or game.'));
    return this.ownerCall('set_game_enabled', { station_id: stationId, game_id: gameId, enabled: Boolean(enabled) }, async (response) => {
      const wire = obj(response.game);
      if (!wire) throw new FleetCallError('bad_response', 'set_game_enabled returned no game.');
      const game = toFleetGame(wire);
      if (stationId === this.currentDeviceId()) {
        // This PC applies the change now, as its next sync would.
        await this.applyOverrides([{ gameId, enabled: Boolean(enabled) }]);
        this.requestSync('remote game change applied');
      }
      return game;
    });
  }

  listModerators(): Promise<FleetResult<ModeratorRecord[]>> {
    return this.ownerCall('list_moderators', {}, (response) =>
      list(response.moderators).flatMap((moderator) => {
        const wire = obj(moderator);
        return wire && str(wire.id) ? [toModerator(wire)] : [];
      })
    );
  }

  saveModerator(input: ModeratorInput): Promise<FleetResult<ModeratorRecord>> {
    const id = str(input?.id).trim();
    const name = str(input?.name).trim();
    const pin = str(input?.pin);
    if (!name) return Promise.resolve(invalidInput('Moderator name is required.'));
    if (name.length > 60) return Promise.resolve(invalidInput('Moderator name must be 60 characters or fewer.'));
    if (!id && !pin) return Promise.resolve(invalidInput('Set a 4 to 12 digit PIN for the new moderator.'));
    if (pin && !isValidPin(pin)) return Promise.resolve(invalidInput('Moderator PINs are 4 to 12 digits.'));
    const stationIds = [...new Set(strings(input?.stationIds))];
    if (stationIds.some((stationId) => !STATION_ID.test(stationId))) return Promise.resolve(invalidInput('Unknown station.'));
    return this.ownerCall('save_moderator', {
      ...(id ? { id } : {}),
      name,
      ...(pin ? { pin } : {}),
      station_ids: stationIds,
      active: input?.active !== false
    }, async (response) => {
      const moderator = obj(response.moderator);
      if (!moderator) throw new FleetCallError('bad_response', 'save_moderator returned no moderator.');
      await logLine('info', `Main admin ${id ? 'updated' : 'added'} moderator ${name}.`);
      // Refresh this PC's cached moderator PINs.
      this.requestSync('moderators changed');
      return toModerator(moderator);
    });
  }

  deleteModerator(id: string): Promise<FleetResult<{ deleted: true }>> {
    if (!str(id)) return Promise.resolve(invalidInput('Unknown moderator.'));
    return this.ownerCall('delete_moderator', { id }, async () => {
      await logLine('info', `Main admin deleted moderator ${id}.`);
      this.requestSync('moderators changed');
      return { deleted: true as const };
    });
  }

  /**
   * Re-registers this PC under a fresh key with the main admin's authority:
   * after it was removed, or when the cloud knows it under another key.
   * Needs an unlocked owner session.
   */
  async rejoin(): Promise<FleetResult<FleetSyncStatus>> {
    const owner = this.validOwner();
    if (!owner) return { ok: false, code: 'owner_pin_required', error: MESSAGES.ownerPinRequired };
    try {
      await this.register(owner.token, true);
      if (this.owner === owner) owner.expiresAt = Date.now() + OWNER_SESSION_MS;
    } catch (error) {
      const callError = asCallError(error);
      await logLine('warn', `Device Management rejoin failed: ${callError.message}`);
      if (callError.code === 'owner_pin_required' && this.owner === owner) this.owner = null;
      return failure(callError);
    }
    await logLine('info', 'This PC rejoined Device Management.');
    await this.syncFresh('rejoin');
    return { ok: true, data: await this.status() };
  }

  // -------------------------------------------------------------------------
  // Earnings
  // -------------------------------------------------------------------------

  /** `device` is built from local records (works offline); `all` comes from the cloud and needs the owner session. */
  async getEarnings(query: EarningsQuery): Promise<FleetResult<EarningsReport>> {
    const range = normalizeRange(query);
    if (!range) return invalidInput('Choose a valid date range.');
    if (query?.scope === 'all') {
      const stationId = str(query.stationId);
      if (stationId && !STATION_ID.test(stationId)) return invalidInput('Unknown station.');
      return this.ownerCall('earnings', {
        ...range,
        ...(stationId ? { station_id: stationId } : {})
      }, (response) =>
        buildEarningsReport(list(response.rows).flatMap(toEarningsRow), {
          scope: 'all',
          ...range,
          truncated: response.truncated === true
        })
      );
    }
    try {
      await this.refreshLocalPayers(range);
      return {
        ok: true,
        data: buildEarningsReport(this.store.listEarningsRows(range), { scope: 'device', ...range })
      };
    } catch (error) {
      await logLine('error', `Could not build this device's earnings: ${String(error)}`);
      return { ok: false, code: 'failed', error: "Couldn't load this device's earnings." };
    }
  }

  /** Best effort: fills in Razorpay payer details the cloud has for local sessions. Never fails the report. */
  private async refreshLocalPayers(range: { from?: string; to?: string }): Promise<void> {
    try {
      const cloud = this.store.getCloudState();
      if (!cloud.stationToken || !cloud.registeredAt || cloud.removedByOwner) return;
      if (!isConfigured(await this.config().catch(() => null))) return;
      const now = Date.now();
      const checkoutIds = this.store.listCheckoutIdsMissingPayers(range, 200)
        .filter((checkoutId) => (this.payerLookups.get(checkoutId) ?? 0) + PAYER_RETRY_MS <= now);
      if (checkoutIds.length === 0) return;
      for (const checkoutId of checkoutIds) this.payerLookups.set(checkoutId, now);
      const response = await this.invoke('session_payers', {
        station_id: this.currentDeviceId(),
        station_token: cloud.stationToken,
        checkout_ids: checkoutIds
      }, PAYER_LOOKUP_TIMEOUT_MS);
      const requested = new Set(checkoutIds.map((checkoutId) => checkoutId.toLowerCase()));
      const payers = normalizePayerList(response.payers).filter((payer) => requested.has(payer.checkoutId.toLowerCase()));
      if (payers.length > 0) await this.store.applySessionPayers(payers);
    } catch (error) {
      const callError = asCallError(error);
      if (callError.code === 'station_removed') await this.markRemovedByOwner();
      await logLine('info', `Payer details lookup skipped: ${callError.message}`);
    }
  }

  // -------------------------------------------------------------------------
  // Station sync
  // -------------------------------------------------------------------------

  private schedule(delayMs: number): void {
    if (!this.started) return;
    const dueAt = Date.now() + delayMs;
    if (this.timer && this.timerDueAt <= dueAt) return;
    if (this.timer) clearTimeout(this.timer);
    this.timerDueAt = dueAt;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.sync('auto');
    }, delayMs);
  }

  /** Waits for a sync already running, then runs a new one. */
  private async syncFresh(trigger: 'manual' | 'rejoin'): Promise<void> {
    while (this.inFlight) await this.inFlight;
    await this.sync(trigger);
  }

  private sync(trigger: 'auto' | 'manual' | 'rejoin'): Promise<void> {
    if (this.inFlight) {
      this.rerunRequested = true;
      return this.inFlight;
    }
    const run = this.performSync(trigger)
      .catch(async (error) => {
        await logLine('error', `Device Management sync failed unexpectedly: ${String(error)}`);
      })
      .finally(() => {
        this.inFlight = null;
        if (this.rerunRequested) {
          this.rerunRequested = false;
          this.schedule(CHANGE_DEBOUNCE_MS);
        }
        this.schedule(SYNC_INTERVAL_MS);
      });
    this.inFlight = run;
    return run;
  }

  private async performSync(trigger: 'auto' | 'manual' | 'rejoin'): Promise<void> {
    if (!isConfigured(await this.config().catch(() => null))) return;
    let cloud = this.store.getCloudState();
    if (cloud.removedByOwner) return;
    if (this.registrationBlocked && trigger === 'auto') return;
    if (!cloud.stationToken || !cloud.registeredAt) {
      try {
        await this.register();
      } catch (error) {
        await this.handleStationError(error);
        return;
      }
      cloud = this.store.getCloudState();
      if (!cloud.stationToken || !cloud.registeredAt) return;
    }
    const stationToken = cloud.stationToken;

    const device = this.store.getCurrentDevice();
    const games = this.store.listGames().slice(0, 500);
    const sessions = this.store.listPendingSyncSessions(SESSION_BATCH);
    let response: WireObject;
    try {
      response = await this.invoke('sync', {
        station_id: device.id,
        station_token: stationToken,
        station: stationPayload(device, this.appVersion),
        games: games.map(gamePayload),
        sessions: sessions.map((session) => this.sessionPayload(session))
      });
    } catch (error) {
      // One malformed session must not block every later sync: park it and retry the rest.
      const callError = asCallError(error);
      const index = /^sessions\[(\d+)\]/.exec(str(callError.body.detail))?.[1];
      const rejected = callError.code === 'invalid_input' && index !== undefined ? sessions[Number(index)] : undefined;
      if (rejected && await this.store.markSessionSyncError(rejected.id, rejected.updatedAt)) {
        await logLine('warn', `Device Management rejected paid session ${rejected.id} (${str(callError.body.detail)}); it will retry after it changes.`);
        this.rerunRequested = true;
      }
      await this.handleStationError(callError);
      return;
    }
    await this.applySyncResponse(response, stationToken, device, games, sessions);
  }

  /**
   * Registers this PC. The PC makes its own key and stores it before asking,
   * so a lost response is retried with the same key (the cloud accepts that
   * again). `rekey` with the owner's token rejoins or re-keys this PC.
   */
  private async register(ownerToken?: string, rekey = false): Promise<void> {
    const device = this.store.getCurrentDevice();
    let token = this.store.getCloudState().stationToken;
    if (!token || rekey || !/^[0-9a-f]{64}$/.test(token)) {
      token = randomBytes(32).toString('hex');
      await this.store.updateCloudState({ stationToken: token, registeredAt: undefined });
    }
    const response = await this.invoke('register', {
      station_id: device.id,
      station_token: token,
      station: stationPayload(device, this.appVersion),
      ...(ownerToken ? { owner_token: ownerToken } : {})
    });
    // A removal or another rejoin replaced the key while this was in flight.
    if (this.store.getCloudState().stationToken !== token) return;
    await this.store.updateCloudState({
      registeredAt: optionalStr(obj(response.station)?.registered_at) ?? new Date().toISOString(),
      removedByOwner: false,
      lastSyncError: undefined
    });
    this.registrationBlocked = false;
    await logLine('info', `Registered this PC (${device.id}) with Device Management${ownerToken ? ' with the main admin' : ''}.`);
  }

  private async applySyncResponse(
    response: WireObject,
    stationToken: string,
    device: DeviceRecord,
    games: GameRecord[],
    sessions: LocalSessionRecord[]
  ): Promise<void> {
    // A late answer must not undo a removal or a rejoin that happened meanwhile.
    const cloud = this.store.getCloudState();
    if (cloud.removedByOwner || cloud.stationToken !== stationToken) {
      await logLine('info', 'Ignored a Device Management sync answer that arrived after this PC was removed or re-keyed.');
      return;
    }
    const syncedAt = new Date().toISOString();
    let deviceChanged = false;
    let gamesChanged = 0;

    // The cloud returns the values it keeps for this PC (the owner's while an
    // owner edit is pending); no clocks are compared.
    const station = obj(response.station);
    if (station) deviceChanged = await this.reconcileDevice(station, device.updatedAt, syncedAt);

    // The owner wins while an override is pending, so every received override applies.
    const overrides: GameOverride[] = list(response.game_overrides).flatMap((entry) => {
      const wire = obj(entry);
      const gameId = str(wire?.game_id);
      return wire && gameId && typeof wire.enabled === 'boolean' ? [{ gameId, enabled: wire.enabled }] : [];
    });
    if (overrides.length > 0) {
      gamesChanged = await this.applyOverrides(overrides, false);
      await logLine('info', `Applied ${overrides.length} remote game change(s) from the main admin.`);
    }

    if (Array.isArray(response.moderators)) {
      const moderators = response.moderators.flatMap((entry) => {
        const wire = obj(entry);
        const id = str(wire?.id);
        const pinHash = str(wire?.pin_hash);
        return wire && id && pinHash ? [{ id, name: str(wire.name) || 'Moderator', pinHash }] : [];
      });
      if (await this.store.setModeratorCredentials(moderators)) {
        await logLine('info', `This PC now accepts ${moderators.length} moderator PIN(s).`);
      }
    }

    const accepted = new Set(strings(response.accepted_session_ids));
    const marked = await this.store.markSessionsSynced(
      sessions.filter((session) => accepted.has(session.id)).map(({ id, updatedAt }) => ({ id, updatedAt })),
      syncedAt
    );
    await this.store.markStationSynced({ games: games.map(({ id, updatedAt }) => ({ id, updatedAt })) }, syncedAt);
    await this.store.updateCloudState({ lastSyncAt: syncedAt, lastSyncError: undefined });
    if (this.lastLoggedSyncError) {
      this.lastLoggedSyncError = undefined;
      await logLine('info', 'Device Management sync recovered.');
    }
    if (marked > 0) await logLine('info', `Device Management accepted ${marked} paid session(s).`);

    if (deviceChanged || gamesChanged > 0) this.emitLocalChange();

    // Acknowledge applied overrides promptly (once), and keep draining a session backlog.
    if (overrides.length > 0 && this.acknowledgementFollowUps < 1) {
      this.acknowledgementFollowUps += 1;
      this.rerunRequested = true;
    } else if (overrides.length === 0) {
      this.acknowledgementFollowUps = 0;
    }
    if (sessions.length >= SESSION_BATCH && marked > 0) this.rerunRequested = true;
  }

  private async handleStationError(error: unknown): Promise<void> {
    const callError = asCallError(error);
    if (callError.code === 'not_configured') return;
    if (callError.code === 'station_removed') {
      await this.markRemovedByOwner();
      return;
    }
    // The cloud knows this PC under another key: only the main admin's rejoin fixes that.
    if (callError.code === 'station_already_registered' || callError.code === 'unauthorized_station') {
      this.registrationBlocked = true;
    }
    const message = failureMessage(callError);
    await this.store.updateCloudState({ lastSyncError: message });
    if (this.lastLoggedSyncError !== callError.message) {
      this.lastLoggedSyncError = callError.message;
      await logLine('warn', `Device Management sync failed: ${callError.message}`);
    }
  }

  private async markRemovedByOwner(): Promise<void> {
    const cloud = this.store.getCloudState();
    await this.store.updateCloudState({
      removedByOwner: true,
      stationToken: undefined,
      registeredAt: undefined,
      moderators: [],
      lastSyncError: MESSAGES.stationRemoved
    });
    if (!cloud.removedByOwner) {
      await logLine('warn', 'The main admin removed this PC from Device Management; sync is paused and moderator PINs were cleared.');
    }
  }

  /** The main admin just saved this PC's details: apply them now and tell the launcher. */
  private async applyOwnerDevice(station: WireObject): Promise<void> {
    try {
      const changed = await this.store.applyCloudDeviceFields(ownerDeviceFields(station, this.store.getCurrentDevice()));
      if (changed) await logLine('info', 'Applied device details changed by the main admin.');
      this.emitLocalChange();
    } catch (error) {
      await logLine('warn', `Could not apply device details from the main admin: ${String(error)}`);
    }
  }

  /** Sync rule: adopt the cloud's values unless this PC was edited while the request was in flight. */
  private async reconcileDevice(station: WireObject, sentUpdatedAt: string, syncedAt: string): Promise<boolean> {
    try {
      const adopted = await this.store.reconcileCloudDevice(
        ownerDeviceFields(station, this.store.getCurrentDevice()),
        sentUpdatedAt,
        syncedAt
      );
      if (adopted) await logLine('info', 'Applied device details kept by Device Management (changed by the main admin).');
      return adopted;
    } catch (error) {
      await logLine('warn', `Could not apply device details from Device Management: ${String(error)}`);
      return false;
    }
  }

  private async applyOverrides(overrides: GameOverride[], emit = true): Promise<number> {
    try {
      const changed = await this.store.applyGameOverrides(overrides);
      if (emit && changed > 0) this.emitLocalChange();
      return changed;
    } catch (error) {
      await logLine('warn', `Could not apply remote game changes: ${String(error)}`);
      return 0;
    }
  }

  private emitLocalChange(): void {
    try {
      this.onLocalDataChanged({ device: this.store.getCurrentDevice(), games: this.store.listGames() });
    } catch (error) {
      void logLine('warn', `Could not publish Device Management changes to the launcher: ${String(error)}`);
    }
  }

  private sessionPayload(session: LocalSessionRecord): WireObject {
    return {
      session_id: session.id,
      status: session.status,
      started_at: session.startedAt,
      expires_at: session.expiresAt,
      ended_at: session.endedAt ?? null,
      duration_minutes: wholeNumber(session.durationMinutes, 100_000),
      amount_paise: wholeNumber(session.amountPaise, 100_000_000),
      currency: session.currency,
      plan_ids: clipList(session.planIds),
      plan_names: clipList(this.store.resolvePlanNames(session.planIds)),
      checkout_ids: clipList(session.checkoutIds),
      games: session.games.slice(0, 200).map((game) => ({
        game_id: game.gameId,
        title: clip(game.title),
        started_at: game.startedAt,
        ended_at: game.endedAt ?? null
      })),
      local_updated_at: session.updatedAt
    };
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  private currentDeviceId(): string {
    return this.store.getCurrentDevice().id;
  }

  private validOwner(): { token: string; expiresAt: number } | null {
    if (this.owner && this.owner.expiresAt > Date.now()) return this.owner;
    this.owner = null;
    return null;
  }

  private async ownerCall<T>(
    action: string,
    body: WireObject,
    map: (response: WireObject) => T | Promise<T>
  ): Promise<FleetResult<T>> {
    const owner = this.validOwner();
    if (!owner) return { ok: false, code: 'owner_pin_required', error: MESSAGES.ownerPinRequired };
    try {
      const response = await this.invoke(action, { ...body, owner_token: owner.token });
      if (this.owner === owner) owner.expiresAt = Date.now() + OWNER_SESSION_MS;
      return { ok: true, data: await map(response) };
    } catch (error) {
      const callError = asCallError(error);
      if (callError.code === 'owner_pin_required' && this.owner === owner) this.owner = null;
      await logLine('warn', `Device Management ${action} failed: ${callError.message}`);
      return failure(callError);
    }
  }

  private config(): Promise<BackendConfig> {
    this.configPromise ??= readBackendConfig();
    return this.configPromise;
  }

  private async invoke(action: string, body: WireObject, timeoutMs = REQUEST_TIMEOUT_MS): Promise<WireObject> {
    const config = await this.config().catch(() => null);
    if (!isConfigured(config)) {
      throw new FleetCallError('not_configured', 'No cloud backend is set in nxgs-client.ini.');
    }
    let response: Response;
    try {
      response = await net.fetch(`${config.functionBaseUrl}/stationFleet`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: config.publishableKey
        },
        body: JSON.stringify({ action, ...body }),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      const reason = error instanceof Error ? error.message : String(error);
      throw new FleetCallError(
        name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'offline',
        `${action} request failed (${config.functionBaseUrl}): ${reason}`
      );
    }
    const text = await response.text().catch(() => '');
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    const result = obj(parsed);
    if (response.ok && result && result.error !== true) return result;
    const code = result?.error === true ? str(result.message) : '';
    if (KNOWN_WIRE_CODES.has(code)) {
      throw new FleetCallError(code, `${action} failed: ${code} (HTTP ${response.status})`, response.status, result);
    }
    if (response.status === 404) {
      throw new FleetCallError('not_deployed', `${action} failed: stationFleet returned HTTP 404`, 404, result ?? {});
    }
    throw new FleetCallError(
      response.status >= 500 ? 'request_failed' : 'bad_response',
      `${action} failed: HTTP ${response.status}${code ? ` (${code})` : ''}`,
      response.status,
      result ?? {}
    );
  }
}
