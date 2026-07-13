export type LaunchType = 'steam' | 'epic' | 'microsoftStore' | 'localExe' | 'custom';

export type AvailabilityStatus = 'available' | 'missing' | 'disabled' | 'unknown';

export interface GameRecord {
  id: string;
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

export interface AppSettings {
  adminPin: string;
  sessionDurationsMinutes: number[];
  kiosk: KioskSettings;
}

export interface AppDatabase {
  schemaVersion: number;
  settings: AppSettings;
  games: GameRecord[];
}

export interface InitialData {
  games: GameRecord[];
  settings: AppSettings;
  appVersion: string;
  platform: NodeJS.Platform;
  dataPath: string;
  logsPath: string;
  isPackaged: boolean;
  activeGame: ActiveGameState;
  diagnostics: AppDiagnostics;
}

export interface SessionState {
  status: 'idle' | 'launching' | 'running' | 'expired' | 'closing' | 'error';
  gameId?: string;
  gameTitle?: string;
  durationMinutes?: number;
  remainingSeconds: number;
  warningFiveMinutes: boolean;
  message?: string;
}

export interface LaunchRequest {
  gameId: string;
  durationMinutes: number;
}

export interface LaunchResult {
  ok: boolean;
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
}

export type BluetoothRadioState = 'on' | 'off' | 'disabled' | 'unknown' | 'unsupported';

export interface BluetoothStatus {
  supported: boolean;
  radioState: BluetoothRadioState;
  devices: BluetoothDeviceSummary[];
  message?: string;
}

export type BluetoothActionStatus = 'connected' | 'paired' | 'disconnected' | 'device-not-found' | 'failed';

export interface BluetoothActionResult {
  ok: boolean;
  status: BluetoothActionStatus;
  message: string;
  bluetooth: BluetoothStatus;
}

export type ShellHomeReason =
  | 'global-home'
  | 'global-f10'
  | 'controller-home'
  | 'controller-combo'
  | 'emergency-close'
  | 'renderer-request'
  | 'system';

export interface ShellHomeEvent {
  reason: ShellHomeReason;
  openActiveGamePanel: boolean;
  emergencyClose: boolean;
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
