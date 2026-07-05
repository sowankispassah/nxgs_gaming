export type LaunchType = 'steam' | 'epic' | 'microsoftStore' | 'localExe' | 'custom';

export type AvailabilityStatus = 'available' | 'missing' | 'disabled' | 'unknown';

export interface GameRecord {
  id: string;
  title: string;
  coverImagePath: string;
  source: string;
  availabilityStatus: AvailabilityStatus;
  launchType: LaunchType;
  launchCommand: string;
  workingDirectory: string;
  processName: string;
  launchArguments: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GameInput {
  id?: string;
  title: string;
  coverImagePath?: string;
  source?: string;
  availabilityStatus?: AvailabilityStatus;
  launchType: LaunchType;
  launchCommand: string;
  workingDirectory?: string;
  processName?: string;
  launchArguments?: string;
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
