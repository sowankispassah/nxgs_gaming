import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DisplayActionResult, DisplayDeviceInfo, DisplayStatus } from '../shared/types';
import { runWindowsControl } from './windowsControlWorker';

const execFileAsync = promisify(execFile);

type RawBrightness = {
  Supported?: unknown;
  Level?: unknown;
  Message?: unknown;
};

const GET_BRIGHTNESS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$monitors = @(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Where-Object { $_.Active -ne $false })
if ($monitors.Count -eq 0) {
    @{ Supported = $false; Message = 'Brightness control is not supported on this display.' } | ConvertTo-Json -Compress
} else {
    $level = [int](($monitors | Measure-Object -Property CurrentBrightness -Average).Average)
    @{ Supported = $true; Level = $level } | ConvertTo-Json -Compress
}
`;

let cachedBrightness: DisplayStatus['brightness'] | null = null;

function normalizeLevel(value: unknown): number {
  const level = Number(value);
  return Number.isFinite(level) ? Math.max(0, Math.min(100, Math.round(level))) : 0;
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/invalid class|not found|not supported/i.test(message)) return 'Brightness control is not supported on this display.';
  if (/access.+denied/i.test(message)) return 'Windows denied access to brightness control.';
  return message || 'Windows display control failed.';
}

async function readBrightness(): Promise<DisplayStatus['brightness']> {
  if (process.platform !== 'win32') {
    return { supported: false, level: 0, message: 'Brightness control is available on supported Windows displays.' };
  }
  const encoded = Buffer.from(GET_BRIGHTNESS_SCRIPT, 'utf16le').toString('base64');
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 }
    );
    const raw = JSON.parse(stdout.trim()) as RawBrightness;
    cachedBrightness = raw.Supported === true
      ? { supported: true, level: normalizeLevel(raw.Level) }
      : { supported: false, level: 0, message: typeof raw.Message === 'string' ? raw.Message : 'Brightness control is not supported on this display.' };
  } catch (error) {
    cachedBrightness = { supported: false, level: 0, message: safeMessage(error) };
  }
  return cachedBrightness;
}

function buildStatus(displays: DisplayDeviceInfo[], brightness: DisplayStatus['brightness']): DisplayStatus {
  const primary = displays.find((display) => display.primary) ?? displays[0];
  const hdrSignal = primary?.depthPerComponent && primary.depthPerComponent >= 10;
  const hdrColorSpace = /hdr|pq|2020/i.test(primary?.colorSpace ?? '');
  return {
    supported: process.platform === 'win32' && displays.length > 0,
    displays,
    currentDisplayId: primary?.id,
    brightness,
    nightLight: {
      supported: false,
      enabled: false,
      controlSupported: false,
      message: 'Night Light control is not supported yet. NXGS will not open Windows Settings.'
    },
    colorProfile: {
      currentProfile: primary?.colorSpace?.trim() || 'Windows system default',
      availableProfiles: primary?.colorSpace?.trim() ? [primary.colorSpace.trim()] : [],
      switchingSupported: false,
      message: 'Color profile switching is not supported yet.'
    },
    hdr: {
      support: hdrSignal || hdrColorSpace ? 'supported' : 'unknown',
      enabled: hdrColorSpace,
      controlSupported: false,
      message: hdrSignal || hdrColorSpace
        ? 'HDR-capable color output was detected. HDR switching is not supported yet.'
        : 'Windows did not expose reliable HDR capability information for this display.'
    },
    message: displays.length === 0 ? 'Windows did not report an active display.' : undefined
  };
}

export async function getDisplayStatus(displays: DisplayDeviceInfo[]): Promise<DisplayStatus> {
  return buildStatus(displays, await readBrightness());
}

export async function setDisplayBrightness(value: number, displays: DisplayDeviceInfo[]): Promise<DisplayActionResult> {
  const level = normalizeLevel(value);
  const brightness = cachedBrightness ?? await readBrightness();
  if (!brightness.supported) {
    return { ok: false, message: brightness.message ?? 'Brightness control is not supported on this display.', display: buildStatus(displays, brightness) };
  }
  try {
    const result = await runWindowsControl('brightness', level);
    if (!result.ok) throw new Error(result.message);
    cachedBrightness = { supported: true, level };
    return { ok: true, message: result.message, display: buildStatus(displays, cachedBrightness) };
  } catch (error) {
    const message = safeMessage(error);
    return { ok: false, message, display: buildStatus(displays, { ...brightness, message }) };
  }
}

export async function setNightLight(_enabled: boolean, displays: DisplayDeviceInfo[]): Promise<DisplayActionResult> {
  const display = buildStatus(displays, cachedBrightness ?? await readBrightness());
  return { ok: false, message: display.nightLight.message, display };
}

export async function setHdr(_enabled: boolean, displays: DisplayDeviceInfo[]): Promise<DisplayActionResult> {
  const display = buildStatus(displays, cachedBrightness ?? await readBrightness());
  return { ok: false, message: display.hdr.message, display };
}
