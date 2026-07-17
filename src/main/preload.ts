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
  verifyPin: (pin: string): Promise<VerifyPinResult> => ipcRenderer.invoke('auth:verifyPin', pin),
  saveGame: (game: GameInput) => ipcRenderer.invoke('games:save', game),
  deleteGame: (id: string) => ipcRenderer.invoke('games:delete', id),
  scanInstalledGames: () => ipcRenderer.invoke('games:scanInstalled'),
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
  launchGame: (request: LaunchRequest): Promise<LaunchResult> => ipcRenderer.invoke('game:launch', request),
  resumeActiveGame: (gameId?: string): Promise<GameControlResult> => ipcRenderer.invoke('game:resumeActive', gameId),
  minimizeActiveGame: (): Promise<GameControlResult> => ipcRenderer.invoke('game:minimizeActive'),
  goToLauncherHome: (): Promise<GameControlResult> => ipcRenderer.invoke('game:goToLauncherHome'),
  closeActiveGame: (gameId?: string): Promise<GameControlResult> => ipcRenderer.invoke('game:closeActive', gameId),
  exitApp: (pin: string): Promise<VerifyPinResult> => ipcRenderer.invoke('app:exit', pin),
  forceCloseGame: (pin: string, gameId?: string): Promise<VerifyPinResult> =>
    ipcRenderer.invoke('session:forceClose', pin, gameId),
  clearExpiredSession: (): Promise<void> => ipcRenderer.invoke('session:clearExpired'),
  onSessionState: (callback: (state: SessionState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: SessionState) => callback(state);
    ipcRenderer.on('session:state', listener);
    return () => {
      ipcRenderer.removeListener('session:state', listener);
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
