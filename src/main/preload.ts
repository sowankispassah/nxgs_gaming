import { contextBridge, ipcRenderer } from 'electron';
import type {
  AdminUnlockRequest,
  AppSettings,
  ActiveGameState,
  AppDiagnostics,
  AudioActionResult,
  AudioStatus,
  BluetoothActionResult,
  BluetoothPairRequest,
  BluetoothStatus,
  ControllerStateReport,
  ControllerIdleNotification,
  ControllerInputState,
  CreatePaymentCheckoutRequest,
  DeviceInput,
  DeviceManagerSummary,
  DisplayActionResult,
  DisplayStatus,
  FilePickerResult,
  GameControlResult,
  GameImageKind,
  GameInput,
  KioskAdminAction,
  KioskAdminActionResult,
  InitialData,
  KioskMode,
  NetworkStatus,
  LaunchRequest,
  LaunchResult,
  PaymentCatalogResult,
  PaymentCheckoutAccess,
  PaymentCheckoutResult,
  PlayPlanInput,
  PlayPlanMutationResult,
  PlayPlanRecord,
  SessionState,
  ShellHomeEvent,
  ShellHomeReason,
  UpdateCheckResult,
  UpdateDownloadProgress,
  UpdateDownloadRequest,
  UpdateDownloadResult,
  UpdateInstallRequest,
  VerifyPinResult,
  WifiActionResult,
  WifiConnectRequest
} from '../shared/types';

const api = {
  getInitialData: (): Promise<InitialData> => ipcRenderer.invoke('app:getInitialData'),
  getDiagnostics: (): Promise<AppDiagnostics> => ipcRenderer.invoke('app:getDiagnostics'),
  getNetworkStatus: (): Promise<NetworkStatus> => ipcRenderer.invoke('network:getStatus'),
  getCurrentWifi: (): Promise<NetworkStatus> => ipcRenderer.invoke('network:getCurrent'),
  scanWifiNetworks: (): Promise<NetworkStatus> => ipcRenderer.invoke('network:scan'),
  connectWifi: (request: WifiConnectRequest): Promise<WifiActionResult> => ipcRenderer.invoke('network:connect', request),
  disconnectWifi: (): Promise<WifiActionResult> => ipcRenderer.invoke('network:disconnect'),
  forgetWifi: (ssid: string): Promise<WifiActionResult> => ipcRenderer.invoke('network:forget', ssid),
  getBluetoothStatus: (): Promise<BluetoothStatus> => ipcRenderer.invoke('bluetooth:getStatus'),
  scanBluetoothDevices: (): Promise<BluetoothStatus> => ipcRenderer.invoke('bluetooth:scan'),
  pairBluetoothDevice: (request: BluetoothPairRequest): Promise<BluetoothActionResult> => ipcRenderer.invoke('bluetooth:pair', request),
  cancelBluetoothPairing: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('bluetooth:cancelPair'),
  disconnectBluetoothDevice: (deviceId: string): Promise<BluetoothActionResult> =>
    ipcRenderer.invoke('bluetooth:disconnect', deviceId),
  removeBluetoothDevice: (deviceId: string): Promise<BluetoothActionResult> => ipcRenderer.invoke('bluetooth:remove', deviceId),
  getAudioStatus: (): Promise<AudioStatus> => ipcRenderer.invoke('audio:getStatus'),
  getAudioOutputDevices: (): Promise<AudioStatus> => ipcRenderer.invoke('audio:getOutputDevices'),
  getAudioInputDevices: (): Promise<AudioStatus> => ipcRenderer.invoke('audio:getInputDevices'),
  setMasterVolume: (volume: number): Promise<AudioActionResult> => ipcRenderer.invoke('audio:setVolume', volume),
  setMasterMuted: (muted: boolean): Promise<AudioActionResult> => ipcRenderer.invoke('audio:setMuted', muted),
  switchAudioOutput: (deviceId: string): Promise<AudioActionResult> => ipcRenderer.invoke('audio:switchOutput', deviceId),
  switchAudioInput: (deviceId: string): Promise<AudioActionResult> => ipcRenderer.invoke('audio:switchInput', deviceId),
  getDisplayStatus: (): Promise<DisplayStatus> => ipcRenderer.invoke('display:getStatus'),
  setBrightness: (value: number): Promise<DisplayActionResult> => ipcRenderer.invoke('display:setBrightness', value),
  setNightLight: (enabled: boolean): Promise<DisplayActionResult> => ipcRenderer.invoke('display:setNightLight', enabled),
  setColorProfile: (profileName: string): Promise<DisplayActionResult> => ipcRenderer.invoke('display:setColorProfile', profileName),
  setHdr: (enabled: boolean): Promise<DisplayActionResult> => ipcRenderer.invoke('display:setHdr', enabled),
  setKioskMode: (mode: KioskMode): Promise<AppDiagnostics> => ipcRenderer.invoke('kiosk:setMode', mode),
  setAdminPinActive: (active: boolean): Promise<{ ok: boolean }> => ipcRenderer.invoke('kiosk:setAdminPinActive', active),
  unlockKioskAdminActions: (pin: string): Promise<VerifyPinResult> => ipcRenderer.invoke('kiosk:unlockAdminActions', pin),
  performKioskAdminAction: (action: KioskAdminAction): Promise<KioskAdminActionResult> =>
    ipcRenderer.invoke('kiosk:performAdminAction', action),
  reportControllerState: (report: ControllerStateReport): Promise<AppDiagnostics> =>
    ipcRenderer.invoke('input:controllerState', report),
  requestShellHome: (reason: ShellHomeReason): Promise<{ ok: boolean }> => ipcRenderer.invoke('shell:homeRequest', reason),
  dismissQuickOverlay: (): Promise<GameControlResult> => ipcRenderer.invoke('shell:dismissQuickOverlay'),
  verifyPin: (pin: string): Promise<VerifyPinResult> => ipcRenderer.invoke('auth:verifyPin', pin),
  getCurrentDevice: (): Promise<DeviceManagerSummary> => ipcRenderer.invoke('device:getCurrent'),
  updateCurrentDevice: (device: DeviceInput): Promise<DeviceManagerSummary> =>
    ipcRenderer.invoke('device:updateCurrent', device),
  saveGame: (game: GameInput) => ipcRenderer.invoke('games:save', game),
  deleteGame: (id: string) => ipcRenderer.invoke('games:delete', id),
  scanInstalledGames: () => ipcRenderer.invoke('games:scanInstalled'),
  listPlayPlans: (): Promise<PlayPlanRecord[]> => ipcRenderer.invoke('plans:list'),
  savePlayPlan: (plan: PlayPlanInput): Promise<PlayPlanMutationResult> => ipcRenderer.invoke('plans:save', plan),
  deletePlayPlan: (id: string): Promise<PlayPlanMutationResult> => ipcRenderer.invoke('plans:delete', id),
  setPlayPlanEnabled: (id: string, enabled: boolean): Promise<PlayPlanMutationResult> =>
    ipcRenderer.invoke('plans:setEnabled', id, enabled),
  reorderPlayPlans: (orderedIds: string[]): Promise<PlayPlanMutationResult> =>
    ipcRenderer.invoke('plans:reorder', orderedIds),
  updateSettings: (settings: AppSettings) => ipcRenderer.invoke('settings:update', settings),
  checkForUpdates: (): Promise<UpdateCheckResult> => ipcRenderer.invoke('updates:check'),
  downloadUpdate: (request: UpdateDownloadRequest): Promise<UpdateDownloadResult> =>
    ipcRenderer.invoke('updates:download', request),
  installUpdate: (request: UpdateInstallRequest): Promise<UpdateDownloadResult> =>
    ipcRenderer.invoke('updates:install', request),
  selectImageFile: (imageKind: GameImageKind = 'cover'): Promise<FilePickerResult> =>
    ipcRenderer.invoke('dialog:selectImageFile', imageKind),
  selectExecutableFile: (): Promise<FilePickerResult> => ipcRenderer.invoke('dialog:selectExecutableFile'),
  selectFolder: (): Promise<FilePickerResult> => ipcRenderer.invoke('dialog:selectFolder'),
  getPaymentCatalog: (): Promise<PaymentCatalogResult> => ipcRenderer.invoke('payment:catalog'),
  createPaymentCheckout: (request: CreatePaymentCheckoutRequest): Promise<PaymentCheckoutResult> =>
    ipcRenderer.invoke('payment:create', request),
  getPaymentStatus: (access: PaymentCheckoutAccess): Promise<PaymentCheckoutResult> =>
    ipcRenderer.invoke('payment:status', access),
  retryPaymentCheckout: (access: PaymentCheckoutAccess): Promise<PaymentCheckoutResult> =>
    ipcRenderer.invoke('payment:retry', access),
  cancelPaymentCheckout: (access: PaymentCheckoutAccess): Promise<PaymentCheckoutResult> =>
    ipcRenderer.invoke('payment:cancel', access),
  consumePaymentCheckout: (access: PaymentCheckoutAccess): Promise<PaymentCheckoutResult> =>
    ipcRenderer.invoke('payment:consume', access),
  launchGame: (request: LaunchRequest): Promise<LaunchResult> => ipcRenderer.invoke('game:launch', request),
  resumeActiveGame: (gameId?: string): Promise<GameControlResult> => ipcRenderer.invoke('game:resumeActive', gameId),
  minimizeActiveGame: (): Promise<GameControlResult> => ipcRenderer.invoke('game:minimizeActive'),
  goToLauncherHome: (): Promise<GameControlResult> => ipcRenderer.invoke('game:goToLauncherHome'),
  closeActiveGame: (gameId?: string): Promise<GameControlResult> => ipcRenderer.invoke('game:closeActive', gameId),
  closeGameForSwitch: (gameId?: string): Promise<GameControlResult> => ipcRenderer.invoke('game:closeForSwitch', gameId),
  exitApp: (pin: string): Promise<VerifyPinResult> => ipcRenderer.invoke('app:exit', pin),
  forceCloseGame: (pin: string, gameId?: string): Promise<VerifyPinResult> =>
    ipcRenderer.invoke('session:forceClose', pin, gameId),
  clearExpiredSession: (): Promise<void> => ipcRenderer.invoke('session:clearExpired'),
  endPaidSession: (): Promise<GameControlResult> => ipcRenderer.invoke('session:end'),
  getPendingSessionExtension: (): Promise<{ id: string; stage: 'two' | 'final' } | null> =>
    ipcRenderer.invoke('session:getPendingExtension'),
  acknowledgeSessionExtensionOpened: (requestId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('session:extensionOpened', requestId),
  cancelSessionExtension: (stage: 'two' | 'final'): Promise<GameControlResult> =>
    ipcRenderer.invoke('session:cancelExtension', stage),
  onSessionState: (callback: (state: SessionState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: SessionState) => callback(state);
    ipcRenderer.on('session:state', listener);
    return () => {
      ipcRenderer.removeListener('session:state', listener);
    };
  },
  onSessionExtendRequested: (callback: (request: { id: string; stage: 'two' | 'final' }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, request: { id: string; stage: 'two' | 'final' }) => callback(request);
    ipcRenderer.on('session:extendRequested', listener);
    return () => {
      ipcRenderer.removeListener('session:extendRequested', listener);
    };
  },
  onControllerIdleNotification: (callback: (notification: ControllerIdleNotification) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, notification: ControllerIdleNotification) => callback(notification);
    ipcRenderer.on('controllerIdle:notification', listener);
    return () => {
      ipcRenderer.removeListener('controllerIdle:notification', listener);
    };
  },
  onControllerInputState: (callback: (state: ControllerInputState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: ControllerInputState) => callback(state);
    ipcRenderer.on('controller:inputState', listener);
    return () => {
      ipcRenderer.removeListener('controller:inputState', listener);
    };
  },
  onUpdateDownloadProgress: (callback: (progress: UpdateDownloadProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: UpdateDownloadProgress) => callback(progress);
    ipcRenderer.on('updates:downloadProgress', listener);
    return () => {
      ipcRenderer.removeListener('updates:downloadProgress', listener);
    };
  },
  onActiveGameState: (callback: (state: ActiveGameState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: ActiveGameState) => callback(state);
    ipcRenderer.on('activeGame:state', listener);
    return () => {
      ipcRenderer.removeListener('activeGame:state', listener);
    };
  },
  onQuickOverlayBackdrop: (callback: (backdrop: { dataUrl: string; displayHeight: number }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      backdrop: { dataUrl: string; displayHeight: number }
    ) => callback(backdrop);
    ipcRenderer.on('quickOverlay:backdrop', listener);
    return () => {
      ipcRenderer.removeListener('quickOverlay:backdrop', listener);
    };
  },
  onShellHome: (callback: (event: ShellHomeEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, event: ShellHomeEvent) => callback(event);
    ipcRenderer.on('shell:home', listener);
    return () => {
      ipcRenderer.removeListener('shell:home', listener);
    };
  },
  onAdminUnlockRequested: (callback: (request: AdminUnlockRequest) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, request: AdminUnlockRequest) => callback(request);
    ipcRenderer.on('kiosk:adminUnlockRequested', listener);
    return () => {
      ipcRenderer.removeListener('kiosk:adminUnlockRequested', listener);
    };
  }
};

contextBridge.exposeInMainWorld('nxgs', api);

export type NxgsApi = typeof api;
