import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logLine } from './logger';

const execFileAsync = promisify(execFile);
const GAME_BAR_PROCESSES = ['GameBar.exe', 'GameBarFTServer.exe', 'XboxGameBarWidgets.exe'];

async function runQuietly(executable: string, args: string[]): Promise<void> {
  try {
    await execFileAsync(executable, args, {
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 1024 * 1024
    });
  } catch {
    // Registry values may already exist and Game Bar processes may not be running.
  }
}

export async function suppressXboxGameBarSurfaces(): Promise<void> {
  if (process.platform !== 'win32') return;
  await Promise.all(
    GAME_BAR_PROCESSES.map((processName) =>
      runQuietly('taskkill.exe', ['/IM', processName, '/T', '/F'])
    )
  );
}

export async function disableXboxGameBarControllerShortcut(): Promise<void> {
  if (process.platform !== 'win32') return;
  await runQuietly('reg.exe', [
    'add',
    'HKCU\\Software\\Microsoft\\GameBar',
    '/v',
    'UseNexusForGameBarEnabled',
    '/t',
    'REG_DWORD',
    '/d',
    '0',
    '/f'
  ]);
  void suppressXboxGameBarSurfaces();
  await logLine('info', 'Disabled the Xbox Game Bar controller Home-button shortcut for NXGS.');
}
