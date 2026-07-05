import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function normalizeProcessName(processName: string): string {
  const trimmed = processName.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.toLowerCase().endsWith('.exe') ? trimmed : `${trimmed}.exe`;
}

export async function isProcessRunning(processName: string): Promise<boolean> {
  if (process.platform !== 'win32') {
    return false;
  }

  const normalized = normalizeProcessName(processName);
  if (!normalized) {
    return false;
  }

  try {
    const { stdout } = await execFileAsync('tasklist.exe', ['/FI', `IMAGENAME eq ${normalized}`, '/FO', 'CSV', '/NH'], {
      windowsHide: true
    });
    return stdout.toLowerCase().includes(normalized.toLowerCase());
  } catch {
    return false;
  }
}

export async function closeProcessByName(processName: string, force: boolean): Promise<void> {
  const normalized = normalizeProcessName(processName);
  if (!normalized) {
    return;
  }
  const args = ['/IM', normalized, '/T'];
  if (force) {
    args.push('/F');
  }
  await execFileAsync('taskkill.exe', args, { windowsHide: true });
}

export async function closeProcessByPid(pid: number, force: boolean): Promise<void> {
  const args = ['/PID', String(pid), '/T'];
  if (force) {
    args.push('/F');
  }
  await execFileAsync('taskkill.exe', args, { windowsHide: true });
}
