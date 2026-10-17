export type LaunchType = 'steam' | 'epic' | 'microsoftStore' | 'localExe' | 'custom';

export type AvailabilityStatus = 'available' | 'missing' | 'disabled' | 'unknown';

export type SyncStatus = 'local' | 'pending' | 'synced' | 'error';
export type DeviceStatus = 'active' | 'inactive';
export type PlanScope = 'device' | 'global';

export interface DeviceRecord {
  id: string;
  name: string;
  storeName: string;
  location: string;
  status: DeviceStatus;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt?: string;
  syncedAt?: string;
  deletedAt?: string;
  syncStatus: SyncStatus;
}

export interface DeviceInput {
  name: string;
  storeName?: string;
  location?: string;
  status?: DeviceStatus;
}

export interface DeviceManagerSummary {
  device: DeviceRecord;
  gameCount: number;
  activePlanCount: number;
  totalPlanCount: number;
  totalSessions: number;
  totalRevenuePaise: number;
  currentSessionStatus: LocalSessionStatus | 'idle';
}

export interface GameRecord {
  id: string;
  deviceId: string;
  title: string;
  avatarImagePath: string;
  coverImagePath: string;
  source: string;
  availabilityStatus: AvailabilityStatus;
  launchType: LaunchType;
  launchCommand: string;
  workingDirectory: string;
  processName: string;
  launchArguments: string;
  launchMode?: GameLaunchMode;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  syncedAt?: string;
  deletedAt?: string;
  syncStatus: SyncStatus;
}

export type GameLaunchMode = 'normal' | 'maximized' | 'fullscreen' | 'borderlessPreferred';

export interface GameInput {
  id?: string;
  title: string;
  avatarImagePath?: string;
  coverImagePath?: string;
  source?: string;
  availabilityStatus?: AvailabilityStatus;
  launchType: LaunchType;
  launchCommand: string;
  workingDirectory?: string;
  processName?: string;
  launchArguments?: string;
  launchMode?: GameLaunchMode;
  enabled?: boolean;
}

export interface GameSuggestion extends GameInput {
  suggestionId: string;
  detectionSource: 'steam' | 'epic' | 'microsoft-store' | 'folder' | 'start-menu';
  confidence: 'high' | 'medium' | 'low';
  launchMethod: string;
  status: 'ready' | 'needs-confirmation' | 'unsupported';
  iconPath?: string;
  notes: string;
}

export interface KioskSettings {
  alwaysOnTop: boolean;
  hideCursorAfterSeconds: number;
  preventClose: boolean;
  refocusOnBlur: boolean;
}

export type ControllerAutoTurnOffMinutes = 0 | 5 | 10 | 15 | 30;

export interface ControllerIdleSettings {
  autoTurnOffMinutes: ControllerAutoTurnOffMinutes;
  shutdownWarning: boolean;
}

export interface BrandingSettings {
  logoPath: string;
}

export interface AppSettings {
  adminPin: string;
  playAccessMode: 'paid' | 'free';
  sessionDurationsMinutes: number[];
  kiosk: KioskSettings;
  controllerIdle: ControllerIdleSettings;
  branding: BrandingSettings;
}

export interface ControllerIdleNotification {
  action: 'show' | 'clear';
  controllerId: string;
  kind: 'warning' | 'error';
  title?: string;
  message?: string;
}

export type ControllerInputDirection = 'left' | 'right' | 'up' | 'down' | 'neutral';

export interface ControllerInputState {
  controllerId: string;
  connected: boolean;
  direction: ControllerInputDirection;
  accept: boolean;
  back: boolean;
  home: boolean;
  receivedAt: number;
}

export interface AppDatabase {
  schemaVersion: number;
  currentDeviceId: string;
  devices: DeviceRecord[];
  settings: AppSettings;
  games: GameRecord[];
  plans: PlayPlanRecord[];
  sessions: LocalSessionRecord[];
  cloud: StationCloudState;
}

export type LocalSessionStatus = 'active' | 'completed' | 'expired' | 'interrupted';

/**
 * Who paid for a checkout, as far as Razorpay knows. Every field is optional:
 * Payment Links usually give a phone number and method but rarely a name, and
 * Razorpay's placeholder email (`void@razorpay.com`) is dropped.
 */
export interface PaymentPayerDetails {
  checkoutId: string;
  razorpayPaymentId?: string;
  name?: string;
  phone?: string;
  email?: string;
  /** Razorpay method: `upi`, `card`, `netbanking`, `wallet`, `emi`, `paylater`, ... */
  method?: string;
  upiId?: string;
  bank?: string;
  wallet?: string;
  cardNetwork?: string;
  cardLast4?: string;
  paidAt?: string;
}

/** One game launched during a paid session. A game relaunched after closing gets a new entry. */
export interface SessionGamePlay {
  gameId: string;
  title: string;
  startedAt: string;
  endedAt?: string;
}

export interface LocalSessionRecord {
  id: string;
  deviceId: string;
  status: LocalSessionStatus;
  planIds: string[];
  checkoutIds: string[];
  /** Games played in this session, oldest first. Empty for sessions recorded before 0.25.0. */
  games: SessionGamePlay[];
  /** Razorpay payer details per checkout, filled at consume time or later from the cloud. */
  payers: PaymentPayerDetails[];
  durationMinutes: number;
  amountPaise: number;
  currency: string;
  startedAt: string;
  expiresAt: string;
  endedAt?: string;
  createdAt: string;
  updatedAt: string;
  syncedAt?: string;
  deletedAt?: string;
  syncStatus: SyncStatus;
}

/** A moderator PIN this station accepts as an admin PIN, cached from the cloud so it works offline. */
export interface CachedModeratorCredential {
  id: string;
  name: string;
  /** `pbkdf2-sha256$<iterations>$<saltHex>$<hashHex>` */
  pinHash: string;
}

/** This station's link to the cloud Device Management service. */
export interface StationCloudState {
  /** Secret issued by `register`; never leaves the main process. */
  stationToken?: string;
  registeredAt?: string;
  lastSyncAt?: string;
  lastSyncError?: string;
  /** The main admin removed this station; automatic sync is paused until it rejoins. */
  removedByOwner: boolean;
  moderators: CachedModeratorCredential[];
}

// ---------------------------------------------------------------------------
// Accounts (earnings) and Device Management (main admin / fleet)
// ---------------------------------------------------------------------------

/** `device` reads this station's local records; `all` reads every station from the cloud and needs the main admin PIN. */
export type EarningsScope = 'device' | 'all';

export interface EarningsQuery {
  scope: EarningsScope;
  /** Inclusive ISO timestamp; omitted means from the beginning. Matched against session `startedAt`. */
  from?: string;
  /** Exclusive ISO timestamp; omitted means up to now. */
  to?: string;
  /** Only for scope `all`: limit to one station. */
  stationId?: string;
}

export interface EarningsSessionRow {
  id: string;
  stationId: string;
  stationName: string;
  status: LocalSessionStatus;
  startedAt: string;
  endedAt?: string;
  /** When the paid time runs out; caps the play time of games left open by a session that never ended cleanly. */
  expiresAt?: string;
  durationMinutes: number;
  amountPaise: number;
  currency: string;
  planNames: string[];
  checkoutIds: string[];
  games: SessionGamePlay[];
  /** One entry per checkout whose payer details are known; empty when none are. */
  payers: PaymentPayerDetails[];
  /** Scope `all` only: every checkout id matches a consumed Razorpay checkout in the cloud. */
  paymentVerified?: boolean;
}

export interface EarningsStationTotal {
  stationId: string;
  stationName: string;
  sessionCount: number;
  amountPaise: number;
}

export interface EarningsGameTotal {
  gameId: string;
  title: string;
  /** Sessions in which this game was played at least once. */
  sessionCount: number;
  /** Sum of play time across entries; open entries count up to the session end (or now). */
  playMinutes: number;
}

export interface EarningsReport {
  scope: EarningsScope;
  generatedAt: string;
  from?: string;
  to?: string;
  currency: string;
  totalPaise: number;
  sessionCount: number;
  paidMinutes: number;
  /** Newest first. */
  rows: EarningsSessionRow[];
  /** Highest amount first. */
  byStation: EarningsStationTotal[];
  /** Most played first. */
  byGame: EarningsGameTotal[];
  /** The cloud returned its maximum number of rows; totals cover only those rows. */
  truncated?: boolean;
}

export type FleetErrorCode =
  | 'owner_pin_required'
  | 'invalid_owner_pin'
  | 'owner_locked'
  | 'offline'
  | 'not_configured'
  | 'not_deployed'
  | 'not_found'
  | 'invalid_input'
  | 'failed';

export interface FleetResult<T> {
  ok: boolean;
  data?: T;
  /** Staff-readable message when `ok` is false. */
  error?: string;
  code?: FleetErrorCode;
}

export interface OwnerSessionState {
  unlocked: boolean;
  expiresAt?: string;
}

export interface OwnerUnlockResult {
  ok: boolean;
  expiresAt?: string;
  error?: string;
  code?: FleetErrorCode;
  /** Set when too many wrong PINs locked the main admin login. */
  lockedUntil?: string;
}

export interface FleetStation {
  /** The station's local device ID. */
  id: string;
  name: string;
  storeName: string;
  location: string;
  status: DeviceStatus;
  appVersion: string;
  registeredAt: string;
  lastSeenAt?: string;
  /** Removed by the main admin; kept so its earnings history stays visible. */
  removedAt?: string;
  gameCount: number;
  sessionCount: number;
  totalRevenuePaise: number;
  /** Computed by the main process: this is the station running the app. */
  isCurrentDevice: boolean;
}

export interface FleetStationGame {
  id: string;
  title: string;
  enabled: boolean;
  launchType: LaunchType;
  source: string;
  availabilityStatus: AvailabilityStatus;
  updatedAt: string;
  /** The main admin changed `enabled` and the station has not applied it yet. */
  pendingOwnerChange: boolean;
}

export interface ModeratorRecord {
  id: string;
  name: string;
  /** Stations where this moderator's PIN unlocks the Control Room. */
  stationIds: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ModeratorInput {
  id?: string;
  name: string;
  /** 4-12 digits. Required when creating; omit to keep the current PIN when editing. */
  pin?: string;
  stationIds: string[];
  active: boolean;
}

export interface FleetStationDetail {
  station: FleetStation;
  games: FleetStationGame[];
  moderators: ModeratorRecord[];
}

export interface FleetStationInput {
  name: string;
  storeName: string;
  location: string;
  status: DeviceStatus;
}

export interface FleetSyncStatus {
  /** nxgs-client.ini has a backend configured. */
  configured: boolean;
  registered: boolean;
  syncing: boolean;
  removedByOwner: boolean;
  lastSyncAt?: string;
  lastSyncError?: string;
  /** Local sessions not yet accepted by the cloud. */
  pendingSessions: number;
  /** Sync is stopped until the main admin rejoins this device (removed, or registered with a lost token). */
  needsRejoin: boolean;
}

/** Sent by the main process when a cloud sync changed this station's device record or games. */
export interface FleetLocalDataChange {
  device: DeviceRecord;
  games: GameRecord[];
}

export interface EarningsExportResult {
  ok: boolean;
  canceled?: boolean;
  path?: string;
  error?: string;
}

export interface InitialData {
  currentDevice: DeviceRecord;
  games: GameRecord[];
  settings: AppSettings;
  appVersion: string;
  platform: NodeJS.Platform;
  dataPath: string;
  logsPath: string;
  isPackaged: boolean;
  activeGame: ActiveGameState;
  session: SessionState;
  diagnostics: AppDiagnostics;
}

export interface SessionState {
  status: 'idle' | 'launching' | 'running' | 'expired' | 'closing' | 'error';
  durationMinutes?: number;
  remainingSeconds: number;
  warningFiveMinutes: boolean;
  expiresAt?: string;
  revision: number;
  message?: string;
}

export interface LaunchRequest {
  gameId: string;
}

export interface LaunchResult {
  ok: boolean;
  error?: string;
}

export interface PaymentPlan {
  id: string;
  name: string;
  durationMinutes: number;
  amountPaise: number;
  currency: string;
}

export interface PlayPlanRecord extends PaymentPlan {
  deviceId?: string;
  scope: PlanScope;
  enabled: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  syncedAt?: string;
  deletedAt?: string;
  syncStatus: SyncStatus;
}

export interface PlayPlanInput {
  id?: string;
  name: string;
  durationMinutes: number;
  amountPaise: number;
  currency?: string;
  scope?: PlanScope;
  enabled?: boolean;
  displayOrder?: number;
}

export interface PlayPlanMutationResult {
  plans: PlayPlanRecord[];
  plan?: PlayPlanRecord;
}

export interface PaymentCatalogResult {
  ok: boolean;
  plans: PaymentPlan[];
  error?: string;
}

export type PaymentCheckoutStatus =
  | 'creating'
  | 'created'
  | 'verified'
  | 'consumed'
  | 'cancelled'
  | 'expired'
  | 'failed';

export interface PaymentCheckout {
  id: string;
  clientToken: string;
  status: PaymentCheckoutStatus;
  plan: PaymentPlan;
  qrDataUrl: string;
  expiresAt: string;
}

export interface CreatePaymentCheckoutRequest {
  timePlanId: string;
}

export interface PaymentCheckoutAccess {
  checkoutId: string;
  clientToken: string;
}

export interface PaymentEntitlement {
  checkoutId: string;
  durationMinutes: number;
  planId?: string;
  amountPaise?: number;
  currency?: string;
  sessionExpiresAt?: string;
  /** Razorpay payer details for this checkout, when the payment function returned them. */
  payer?: PaymentPayerDetails;
}

export interface PaymentCheckoutResult {
  ok: boolean;
  status?: PaymentCheckoutStatus;
  checkout?: PaymentCheckout;
  entitlement?: PaymentEntitlement;
  error?: string;
}

export interface GameControlResult {
  ok: boolean;
  error?: string;
}

export type ActiveGameStatus =
  | 'idle'
  | 'launching'
  | 'running'
  | 'quickOverlayOpen'
  | 'minimizedToHome'
  | 'resuming'
  | 'closing'
  | 'closed'
  | 'error';

export type ActiveGameWindowState = 'foreground' | 'minimized' | 'background' | 'unknown';

export interface TrackedGameSessionState {
  game: GameRecord;
  status: ActiveGameStatus;
  message?: string;
  windowDetected: boolean;
  windowState: ActiveGameWindowState;
  isActive: boolean;
  updatedAt: string;
}

export interface ActiveGameState {
  status: ActiveGameStatus;
  game?: GameRecord;
  message?: string;
  windowDetected?: boolean;
  windowState?: ActiveGameWindowState;
  sessions?: TrackedGameSessionState[];
  updatedAt: string;
}

export type ControllerHomeSupport = 'yes' | 'no' | 'unknown';

export type KioskMode = 'customer' | 'admin';

export type ControllerCompatibilityStatus =
  | 'unavailable'
  | 'idle'
  | 'starting'
  | 'installingDriver'
  | 'driverRequired'
  | 'waitingForController'
  | 'ready'
  | 'error';

export interface ControllerCompatibilityDiagnostics {
  status: ControllerCompatibilityStatus;
  driverInstalled: boolean;
  mapperRunning: boolean;
  xinputReady: boolean;
  message?: string;
  lastError?: string;
  updatedAt?: string;
}

export type KioskAdminAction =
  | 'minimize'
  | 'exitFullscreen'
  | 'openManagement'
  | 'closeApp'
  | 'returnLocked';

export interface KioskAdminActionResult {
  ok: boolean;
  error?: string;
}

export interface AppDiagnostics {
  shortcuts: {
    homeRegistered: boolean;
    f10Registered: boolean;
    emergencyCloseRegistered: boolean;
    adminUnlockRegistered: boolean;
    restrictedRegisteredCount: number;
    failures: string[];
  };
  controller: {
    detected: boolean;
    homeSupported: ControllerHomeSupport;
    name?: string;
    lastInputAt?: string;
    lastButtonPressed?: string;
    lastNavigationAction?: string;
  };
  controllerCompatibility: ControllerCompatibilityDiagnostics;
  activeGame: {
    title?: string;
    processId?: number;
    windowHandle?: number;
    windowDetected: boolean;
    status: ActiveGameStatus;
    windowState?: ActiveGameWindowState;
    lastError?: string;
    lastHomeResult?: string;
    lastResumeResult?: string;
  };
  kiosk: {
    mode: KioskMode;
    taskbarHidden: boolean;
    alwaysOnTop: boolean;
    launcherVisible: boolean;
    fullscreen: boolean;
    maximized: boolean;
    resizable: boolean;
    lastHomeTrigger?: ShellHomeReason;
    lastRestrictedInput?: string;
    lastInputError?: string;
  };
}

export interface ControllerStateReport {
  detected: boolean;
  homeSupported: ControllerHomeSupport;
  name?: string;
  lastButtonPressed?: string;
  lastNavigationAction?: string;
}

export interface WifiNetworkSummary {
  ssid: string;
  signal?: string;
  security?: string;
  encryption?: string;
  requiresPassword: boolean;
  saved: boolean;
}

export type NetworkConnectivity = 'internet' | 'limited' | 'none' | 'unknown';

export interface NetworkStatus {
  supported: boolean;
  connected: boolean;
  interfaceName?: string;
  ssid?: string;
  signal?: string;
  connectivity: NetworkConnectivity;
  availableNetworks: WifiNetworkSummary[];
  message?: string;
}

export interface WifiConnectRequest {
  ssid: string;
  password?: string;
}

export type WifiActionStatus =
  | 'connected'
  | 'disconnected'
  | 'forgotten'
  | 'incorrect-password'
  | 'failed';

export interface WifiActionResult {
  ok: boolean;
  status: WifiActionStatus;
  message: string;
  network: NetworkStatus;
}

export interface BluetoothDeviceSummary {
  id: string;
  name: string;
  address?: string;
  paired: boolean;
  connected: boolean;
  connectable: boolean;
  controller: boolean;
  inputReady: boolean;
}

export type BluetoothRadioState = 'on' | 'off' | 'disabled' | 'unknown' | 'unsupported';

export interface BluetoothStatus {
  supported: boolean;
  radioState: BluetoothRadioState;
  devices: BluetoothDeviceSummary[];
  message?: string;
}

export interface BluetoothPairRequest {
  device: BluetoothDeviceSummary;
  bluetooth: BluetoothStatus;
  fastPairing: boolean;
}

export type BluetoothActionStatus =
  | 'connected'
  | 'paired'
  | 'disconnected'
  | 'removed'
  | 'device-not-found'
  | 'staff-approval-required'
  | 'failed';

export interface BluetoothActionResult {
  ok: boolean;
  status: BluetoothActionStatus;
  message: string;
  bluetooth: BluetoothStatus;
}

export interface AudioDeviceSummary {
  id: string;
  name: string;
  kind: 'output' | 'input';
  isDefault: boolean;
  volume: number;
  muted: boolean;
}

export interface AudioStatus {
  supported: boolean;
  masterVolume: number;
  muted: boolean;
  inputVolume: number;
  inputMuted: boolean;
  outputDevices: AudioDeviceSummary[];
  inputDevices: AudioDeviceSummary[];
  currentOutputId?: string;
  currentOutputName?: string;
  currentInputId?: string;
  currentInputName?: string;
  deviceSwitchingSupported: boolean;
  message?: string;
}

export interface AudioActionResult {
  ok: boolean;
  message: string;
  audio: AudioStatus;
}

export interface DisplayDeviceInfo {
  id: string;
  name: string;
  resolution: string;
  refreshRate: number;
  scalePercent: number;
  orientation: 'Landscape' | 'Portrait' | 'Landscape (flipped)' | 'Portrait (flipped)';
  primary: boolean;
  internal: boolean;
  colorDepth: number;
  depthPerComponent: number;
  colorSpace: string;
}

export interface DisplayStatus {
  supported: boolean;
  displays: DisplayDeviceInfo[];
  currentDisplayId?: string;
  brightness: {
    supported: boolean;
    level: number;
    message?: string;
  };
  nightLight: {
    supported: boolean;
    enabled: boolean;
    controlSupported: boolean;
    message: string;
  };
  colorProfile: {
    currentProfile: string;
    availableProfiles: string[];
    switchingSupported: boolean;
    message: string;
  };
  hdr: {
    support: 'supported' | 'unsupported' | 'unknown';
    enabled: boolean;
    controlSupported: boolean;
    message: string;
  };
  message?: string;
}

export interface DisplayActionResult {
  ok: boolean;
  message: string;
  display: DisplayStatus;
}

export type ShellHomeReason =
  | 'global-home'
  | 'global-f10'
  | 'windows-key'
  | 'controller-home'
  | 'controller-combo'
  | 'emergency-close'
  | 'renderer-request'
  | 'second-instance'
  | 'system';

export interface ShellHomeEvent {
  reason: ShellHomeReason;
  openActiveGamePanel: boolean;
  emergencyClose: boolean;
  preserveAdminWindow?: boolean;
  openQuickNav?: boolean;
  resetToHome?: boolean;
}

export type QuickOverlayBackdropKind = 'live' | 'direct' | 'snapshot' | 'cover' | 'generated';

export interface QuickOverlayBackdrop {
  requestId: number;
  gameId?: string;
  kind: QuickOverlayBackdropKind;
  imageUrl?: string;
  posterKind?: 'snapshot' | 'cover';
  sourceId?: string;
  capturedWindowHandle?: number;
  cropTopPx?: number;
}

export interface AdminUnlockRequest {
  source: string;
  key?: string;
  action?: Extract<KioskAdminAction, 'closeApp' | 'exitFullscreen' | 'minimize'>;
  message: string;
  requestedAt: string;
}

export interface VerifyPinResult {
  ok: boolean;
  /** Who unlocked: the station's own admin PIN or a moderator PIN from Device Management. */
  role?: 'admin' | 'moderator';
}

export interface FilePickerResult {
  canceled: boolean;
  path?: string;
  fileName?: string;
  directory?: string;
  error?: string;
}

export type GameImageKind = 'avatar' | 'cover';

export type UpdateCheckStatus = 'latest' | 'available' | 'failed';

export interface UpdateCheckResult {
  status: UpdateCheckStatus;
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  assetName?: string;
  downloadUrl?: string;
  sha256?: string;
  required?: boolean;
  notes?: string;
  source?: 'manifest' | 'github-release';
  canDownload?: boolean;
  message: string;
  checkedAt: string;
}

export interface UpdateDownloadRequest {
  downloadUrl: string;
  assetName?: string;
  sha256?: string;
  latestVersion?: string;
}

export interface UpdateDownloadResult {
  ok: boolean;
  installerPath?: string;
  sha256?: string;
  message: string;
}

export interface UpdateInstallRequest {
  installerPath: string;
  sha256?: string;
}

export interface UpdateDownloadProgress {
  receivedBytes: number;
  totalBytes?: number;
  percent: number;
}
