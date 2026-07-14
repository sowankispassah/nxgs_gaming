import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DisplayActionResult, DisplayDeviceInfo, DisplayStatus } from '../shared/types';
import { changeColorProfile, changeHdr, getAdvancedDisplayFeatures, type AdvancedDisplayFeatures } from './displayFeatureService';
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
let cachedAdvancedFeatures: AdvancedDisplayFeatures | null = null;

function normalizeLevel(value: unknown): number {
  const level = Number(value);
  return Number.isFinite(level) ? Math.max(0, Math.min(100, Math.round(level))) : 0;
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/invalid class|not found|not supported/i.test(message)) return 'Brightness control is not supported on this display.';
  if (/access.+denied/i.test(message)) return 'Access to brightness control was denied.';
  return message || 'The display action failed.';
}

async function readBrightness(): Promise<DisplayStatus['brightness']> {
  if (process.platform !== 'win32') {
    return { supported: false, level: 0, message: 'Brightness control is unavailable on this display.' };
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

function fallbackAdvancedFeatures(primary?: DisplayDeviceInfo): AdvancedDisplayFeatures {
  return {
    colorProfile: {
      currentProfile: primary?.colorSpace?.trim() || 'System default',
      availableProfiles: [],
      switchingSupported: false,
      message: 'No selectable color profiles were found for this display.'
    },
    hdr: {
      support: 'unknown',
      enabled: false,
      controlSupported: false,
      message: 'HDR capability information is unavailable for this display.'
    }
  };
}

function buildStatus(displays: DisplayDeviceInfo[], brightness: DisplayStatus['brightness'], advanced?: AdvancedDisplayFeatures | null): DisplayStatus {
  const primary = displays.find((display) => display.primary) ?? displays[0];
  const features = advanced ?? fallbackAdvancedFeatures(primary);
  return {
    supported: process.platform === 'win32' && displays.length > 0,
    displays,
    currentDisplayId: primary?.id,
    brightness,
    nightLight: {
      supported: false,
      enabled: false,
      controlSupported: false,
      message: 'Night Light control is unavailable on this device.'
    },
    colorProfile: features.colorProfile,
    hdr: features.hdr,
    message: displays.length === 0 ? 'No active display was found.' : undefined
  };
}

export async function getDisplayStatus(displays: DisplayDeviceInfo[]): Promise<DisplayStatus> {
  const [brightness, advanced] = await Promise.all([
    readBrightness(),
    getAdvancedDisplayFeatures().catch((error) => {
      if (cachedAdvancedFeatures) return cachedAdvancedFeatures;
      const fallback = fallbackAdvancedFeatures(displays.find((display) => display.primary) ?? displays[0]);
      const message = safeMessage(error);
      fallback.colorProfile.message = `Color-profile check failed: ${message}`;
      fallback.hdr.message = `HDR check failed: ${message}`;
      return fallback;
    })
  ]);
  cachedAdvancedFeatures = advanced;
  return buildStatus(displays, brightness, advanced);
}

export async function setDisplayBrightness(value: number, displays: DisplayDeviceInfo[]): Promise<DisplayActionResult> {
  const level = normalizeLevel(value);
  const brightness = cachedBrightness ?? await readBrightness();
  if (!brightness.supported) {
    return { ok: false, message: brightness.message ?? 'Brightness control is not supported on this display.', display: buildStatus(displays, brightness, cachedAdvancedFeatures) };
  }
  try {
    const result = await runWindowsControl('brightness', level);
    if (!result.ok) throw new Error(result.message);
    cachedBrightness = { supported: true, level };
    return { ok: true, message: result.message, display: buildStatus(displays, cachedBrightness, cachedAdvancedFeatures) };
  } catch (error) {
    const message = safeMessage(error);
    return { ok: false, message, display: buildStatus(displays, { ...brightness, message }, cachedAdvancedFeatures) };
  }
}

export async function setNightLight(_enabled: boolean, displays: DisplayDeviceInfo[]): Promise<DisplayActionResult> {
  const display = buildStatus(displays, cachedBrightness ?? await readBrightness(), cachedAdvancedFeatures);
  return { ok: false, message: display.nightLight.message, display };
}

export async function setHdr(enabled: boolean, displays: DisplayDeviceInfo[]): Promise<DisplayActionResult> {
  try {
    cachedAdvancedFeatures = await changeHdr(enabled);
    const display = buildStatus(displays, cachedBrightness ?? await readBrightness(), cachedAdvancedFeatures);
    return { ok: display.hdr.enabled === enabled, message: display.hdr.enabled === enabled ? `HDR turned ${enabled ? 'on' : 'off'}.` : display.hdr.message, display };
  } catch (error) {
    const message = safeMessage(error);
    return { ok: false, message, display: buildStatus(displays, cachedBrightness ?? await readBrightness(), cachedAdvancedFeatures) };
  }
}

export async function setColorProfile(profileName: string, displays: DisplayDeviceInfo[]): Promise<DisplayActionResult> {
  try {
    cachedAdvancedFeatures = await changeColorProfile(profileName);
    const display = buildStatus(displays, cachedBrightness ?? await readBrightness(), cachedAdvancedFeatures);
    return { ok: display.colorProfile.currentProfile.toLocaleLowerCase() === profileName.toLocaleLowerCase(), message: `Color profile changed to ${display.colorProfile.currentProfile}.`, display };
  } catch (error) {
    const message = safeMessage(error);
    return { ok: false, message, display: buildStatus(displays, cachedBrightness ?? await readBrightness(), cachedAdvancedFeatures) };
  }
}
