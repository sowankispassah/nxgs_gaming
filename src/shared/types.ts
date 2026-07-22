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

export interface AppSettings {
  adminPin: string;
  sessionDurationsMinutes: number[];
  kiosk: KioskSettings;
  controllerIdle: ControllerIdleSettings;
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
}

export type LocalSessionStatus = 'active' | 'completed' | 'expired' | 'interrupted';

export interface LocalSessionRecord {
  id: string;
  deviceId: string;
  status: LocalSessionStatus;
  planIds: string[];
  checkoutIds: string[];
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

export interface AdminUnlockRequest {
  source: string;
  key?: string;
  message: string;
  requestedAt: string;
}

export interface VerifyPinResult {
  ok: boolean;
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
