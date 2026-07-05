import { app } from 'electron';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export function getLogPath(): string {
  return join(app.getPath('logs'), 'nxgs-play.log');
}

export async function logLine(level: 'info' | 'warn' | 'error', message: string): Promise<void> {
  const logPath = getLogPath();
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}\n`;
  try {
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(logPath, line, 'utf8');
  } catch {
    // Logging must never be able to crash kiosk flow.
  }
}
