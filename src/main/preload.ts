import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppSettings,
  FilePickerResult,
  GameInput,
  InitialData,
  LaunchRequest,
  LaunchResult,
  SessionState,
  UpdateCheckResult,
  UpdateDownloadProgress,
  UpdateDownloadRequest,
  UpdateDownloadResult,
  UpdateInstallRequest,
  VerifyPinResult
} from '../shared/types';

const api = {
  getInitialData: (): Promise<InitialData> => ipcRenderer.invoke('app:getInitialData'),
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
  selectImageFile: (): Promise<FilePickerResult> => ipcRenderer.invoke('dialog:selectImageFile'),
  selectExecutableFile: (): Promise<FilePickerResult> => ipcRenderer.invoke('dialog:selectExecutableFile'),
  selectFolder: (): Promise<FilePickerResult> => ipcRenderer.invoke('dialog:selectFolder'),
  launchGame: (request: LaunchRequest): Promise<LaunchResult> => ipcRenderer.invoke('game:launch', request),
  exitApp: (pin: string): Promise<VerifyPinResult> => ipcRenderer.invoke('app:exit', pin),
  forceCloseGame: (pin: string): Promise<VerifyPinResult> => ipcRenderer.invoke('session:forceClose', pin),
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
  }
};

contextBridge.exposeInMainWorld('nxgs', api);

export type NxgsApi = typeof api;
