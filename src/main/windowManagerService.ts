import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GameLaunchMode } from '../shared/types';
import { normalizeProcessName } from './windowsProcess';

const execFileAsync = promisify(execFile);

export interface GameWindowInfo {
  handle: number;
  processId: number;
  processName: string;
  title: string;
}

export interface GameWindowSearch {
  pid?: number;
  processName?: string;
  titleHint?: string;
}

type WindowCommand = 'foreground' | 'maximize' | 'restore' | 'minimize' | 'close';

interface ActivationOptions {
  foreground: boolean;
  topMost: boolean;
  applyBorderless: boolean;
}

export interface GameWindowActivationState {
  foregroundHandle: number;
  isForeground: boolean;
  isMinimized: boolean;
  isVisible: boolean;
  height: number;
  width: number;
  x: number;
  y: number;
}

export async function setWindowsTaskbarVisible(visible: boolean): Promise<void> {
  if (process.platform !== 'win32') {
    return;
  }

  const command = visible ? 5 : 0;
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class TaskbarWin32 {
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr FindWindowEx(IntPtr hwndParent, IntPtr hwndChildAfter, string lpszClass, string lpszWindow);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$command = ${command}
$classes = @("Shell_TrayWnd", "Shell_SecondaryTrayWnd")
foreach ($class in $classes) {
  $main = [TaskbarWin32]::FindWindow($class, $null)
  if ($main -ne [IntPtr]::Zero) {
    [TaskbarWin32]::ShowWindow($main, $command) | Out-Null
  }

  $after = [IntPtr]::Zero
  while ($true) {
    $hwnd = [TaskbarWin32]::FindWindowEx([IntPtr]::Zero, $after, $class, $null)
    if ($hwnd -eq [IntPtr]::Zero) { break }
    [TaskbarWin32]::ShowWindow($hwnd, $command) | Out-Null
    $after = $hwnd
  }
}
`;

  await runPowerShell(script);
}

function powershellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function runPowerShell(script: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      maxBuffer: 1024 * 1024,
      timeout: 8000,
      windowsHide: true
    }
  );
  return stdout.trim();
}

function parseWindowInfo(raw: string): GameWindowInfo | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<GameWindowInfo>;
    if (!parsed.handle || !parsed.processId) {
      return null;
    }
    return {
      handle: Number(parsed.handle),
      processId: Number(parsed.processId),
      processName: String(parsed.processName ?? ''),
      title: String(parsed.title ?? '')
    };
  } catch {
    return null;
  }
}

export async function findGameWindow(search: GameWindowSearch): Promise<GameWindowInfo | null> {
  if (process.platform !== 'win32') {
    return null;
  }

  const normalizedName = search.processName ? normalizeProcessName(search.processName).replace(/\.exe$/i, '') : '';
  const pid = Number.isFinite(search.pid) ? Number(search.pid) : 0;
  const titleHint = search.titleHint?.trim().toLowerCase() ?? '';
  const script = `
$ErrorActionPreference = "SilentlyContinue"
$items = @()
if (${pid} -gt 0) {
  $pidProcess = Get-Process -Id ${pid}
  if ($pidProcess) { $items += $pidProcess }
}
if (${powershellQuote(normalizedName)} -ne "") {
  $items += Get-Process -Name ${powershellQuote(normalizedName)}
}
if (${powershellQuote(titleHint)} -ne "") {
  $hint = ${powershellQuote(titleHint)}
  $terms = @($hint -split '[^a-z0-9]+' | Where-Object { $_.Length -gt 2 } | Select-Object -First 2)
  $items += Get-Process |
    Where-Object {
      if (-not ($_.MainWindowHandle -and $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle)) { return $false }
      $title = $_.MainWindowTitle.ToLower()
      if ($title.Contains($hint)) { return $true }
      if ($terms.Count -eq 0) { return $false }
      foreach ($term in $terms) {
        if (-not $title.Contains($term)) { return $false }
      }
      return $true
    }
}
$selected = $items |
  Sort-Object Id -Unique |
  Where-Object { $_.MainWindowHandle -and $_.MainWindowHandle -ne 0 } |
  Sort-Object StartTime -Descending |
  Select-Object -First 1
if ($selected) {
  [pscustomobject]@{
    handle = [int64]$selected.MainWindowHandle
    processId = [int]$selected.Id
    processName = [string]$selected.ProcessName
    title = [string]$selected.MainWindowTitle
  } | ConvertTo-Json -Compress
}
`;

  return parseWindowInfo(await runPowerShell(script));
}

export async function waitForGameWindow(
  search: GameWindowSearch,
  timeoutMs = 20000,
  fastIntervalMs = 125,
  settledIntervalMs = 250
): Promise<GameWindowInfo | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const window = await findGameWindow(search);
    if (window) {
      return window;
    }
    const elapsedMs = Date.now() - startedAt;
    const intervalMs = elapsedMs < 5000 ? fastIntervalMs : settledIntervalMs;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

async function runWindowCommand(handle: number, command: WindowCommand): Promise<void> {
  if (process.platform !== 'win32' || !Number.isFinite(handle) || handle <= 0) {
    return;
  }

  const commandScript =
    command === 'minimize'
      ? '[Win32]::ShowWindowAsync($hwnd, 6) | Out-Null'
      : command === 'restore'
        ? '[Win32]::ShowWindowAsync($hwnd, 9) | Out-Null'
        : command === 'maximize'
          ? '[Win32]::ShowWindowAsync($hwnd, 3) | Out-Null'
          : command === 'close'
            ? [
                '[Win32]::OpenIcon($hwnd) | Out-Null',
                '[Win32]::ShowWindow($hwnd, 9) | Out-Null',
                '[Win32]::BringWindowToTop($hwnd) | Out-Null',
                '[Win32]::SetForegroundWindow($hwnd) | Out-Null',
                'Start-Sleep -Milliseconds 120',
                '[Win32]::PostMessage($hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null'
              ].join('; ')
            : [
                '[Win32]::ShowWindowAsync($hwnd, 9) | Out-Null',
                '[Win32]::BringWindowToTop($hwnd) | Out-Null',
                '[Win32]::SetForegroundWindow($hwnd) | Out-Null'
              ].join('; ');

  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32 {
  [DllImport("user32.dll")] public static extern bool OpenIcon(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
}
"@
$hwnd = [IntPtr]${Math.trunc(handle)}
${commandScript}
`;

  await runPowerShell(script);
}

function parseActivationState(raw: string): GameWindowActivationState | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<GameWindowActivationState>;
    return {
      foregroundHandle: Number(parsed.foregroundHandle ?? 0),
      isForeground: Boolean(parsed.isForeground),
      isMinimized: Boolean(parsed.isMinimized),
      isVisible: Boolean(parsed.isVisible),
      height: Number(parsed.height ?? 0),
      width: Number(parsed.width ?? 0),
      x: Number(parsed.x ?? 0),
      y: Number(parsed.y ?? 0)
    };
  } catch {
    return null;
  }
}

async function runActivationCommand(
  handle: number,
  launchMode: GameLaunchMode,
  compensateFrameChrome = false,
  options: Partial<ActivationOptions> = {}
): Promise<GameWindowActivationState | null> {
  if (process.platform !== 'win32' || !Number.isFinite(handle) || handle <= 0) {
    return null;
  }

  const useBorderless = launchMode !== 'normal' && options.applyBorderless !== false;
  const foreground = options.foreground ?? true;
  const topMost = options.topMost ?? launchMode !== 'normal';
  const overscanPx = useBorderless ? 2 : 0;
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;

public struct RECT {
  public int Left;
  public int Top;
  public int Right;
  public int Bottom;
}

public struct MONITORINFO {
  public int cbSize;
  public RECT rcMonitor;
  public RECT rcWork;
  public uint dwFlags;
}

public static class Win32 {
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint dwFlags);
  [DllImport("user32.dll")] public static extern bool OpenIcon(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll", EntryPoint="GetWindowLong")] public static extern int GetWindowLong32(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtr")] public static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll", EntryPoint="SetWindowLong")] public static extern int SetWindowLong32(IntPtr hWnd, int nIndex, int dwNewLong);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtr")] public static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

  public static IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex) {
    if (IntPtr.Size == 8) return GetWindowLongPtr64(hWnd, nIndex);
    return new IntPtr(GetWindowLong32(hWnd, nIndex));
  }

  public static IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong) {
    if (IntPtr.Size == 8) return SetWindowLongPtr64(hWnd, nIndex, dwNewLong);
    return new IntPtr(SetWindowLong32(hWnd, nIndex, dwNewLong.ToInt32()));
  }
}
"@
$hwnd = [IntPtr]${Math.trunc(handle)}
$flags = 0x0001 -bor 0x0002 -bor 0x0040
$topMost = [IntPtr](-1)
$notTopMost = [IntPtr](-2)
$useBorderless = ${useBorderless ? '$true' : '$false'}
$activateForeground = ${foreground ? '$true' : '$false'}
$useTopMost = ${topMost ? '$true' : '$false'}
$overscanPx = ${overscanPx}
$compensateFrameChrome = ${compensateFrameChrome ? '$true' : '$false'}
[Win32]::AllowSetForegroundWindow(-1) | Out-Null
[Win32]::OpenIcon($hwnd) | Out-Null
[Win32]::ShowWindow($hwnd, 9) | Out-Null
Start-Sleep -Milliseconds 80
[Win32]::ShowWindowAsync($hwnd, 9) | Out-Null
if ($useBorderless) {
  $gwlStyle = -16
  $gwlExStyle = -20
  $wsPopup = 0x80000000L
  $wsVisible = 0x10000000L
  $wsOverlappedWindow = 0x00CF0000L
  $borderExStyles = 0x00000001L -bor 0x00000100L -bor 0x00000200L -bor 0x00020000L -bor 0x00040000L
  $style = [Win32]::GetWindowLongPtr($hwnd, $gwlStyle).ToInt64()
  $exStyle = [Win32]::GetWindowLongPtr($hwnd, $gwlExStyle).ToInt64()
  $newStyle = ($style -band (-bnot $wsOverlappedWindow)) -bor $wsPopup -bor $wsVisible
  $newExStyle = $exStyle -band (-bnot $borderExStyles)
  [Win32]::SetWindowLongPtr($hwnd, $gwlStyle, [IntPtr]$newStyle) | Out-Null
  [Win32]::SetWindowLongPtr($hwnd, $gwlExStyle, [IntPtr]$newExStyle) | Out-Null
  try {
    $disable = 1
    $cornerAttr = 33
    $borderColorAttr = 34
    $colorNone = -2
    [Win32]::DwmSetWindowAttribute($hwnd, $cornerAttr, [ref]$disable, 4) | Out-Null
    [Win32]::DwmSetWindowAttribute($hwnd, $borderColorAttr, [ref]$colorNone, 4) | Out-Null
  } catch {}

  $monitor = [Win32]::MonitorFromWindow($hwnd, 2)
  $monitorInfo = New-Object MONITORINFO
  $monitorInfo.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([type][MONITORINFO])
  if ([Win32]::GetMonitorInfo($monitor, [ref]$monitorInfo)) {
    $x = $monitorInfo.rcMonitor.Left - $overscanPx
    $y = $monitorInfo.rcMonitor.Top - $overscanPx
    $width = ($monitorInfo.rcMonitor.Right - $monitorInfo.rcMonitor.Left) + ($overscanPx * 2)
    $height = ($monitorInfo.rcMonitor.Bottom - $monitorInfo.rcMonitor.Top) + ($overscanPx * 2)
    $chromeOffset = 0
    if ($compensateFrameChrome) {
      $chromeOffset = [Math]::Max(
        36,
        [Win32]::GetSystemMetrics(4) + [Win32]::GetSystemMetrics(33) + [Win32]::GetSystemMetrics(92) + 8
      )
    }
    $y = $y - $chromeOffset
    $height = $height + $chromeOffset
    $sizeFlags = 0x0020 -bor 0x0040
    if (-not $activateForeground) {
      $sizeFlags = $sizeFlags -bor 0x0010
    }
    [Win32]::SetWindowPos($hwnd, [IntPtr]::Zero, $x, $y, $width, $height, $sizeFlags) | Out-Null
  }
}
if ($useTopMost) {
  [Win32]::SetWindowPos($hwnd, $topMost, 0, 0, 0, 0, $flags) | Out-Null
} else {
  [Win32]::SetWindowPos($hwnd, $notTopMost, 0, 0, 0, 0, $flags) | Out-Null
}
if ($activateForeground) {
  [Win32]::BringWindowToTop($hwnd) | Out-Null
  [Win32]::SetForegroundWindow($hwnd) | Out-Null
}
Start-Sleep -Milliseconds 160
$foreground = [Win32]::GetForegroundWindow()
$rect = New-Object RECT
[Win32]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
[pscustomobject]@{
  foregroundHandle = [int64]$foreground
  isForeground = ($foreground -eq $hwnd)
  isMinimized = [Win32]::IsIconic($hwnd)
  isVisible = [Win32]::IsWindowVisible($hwnd)
  x = [int]$rect.Left
  y = [int]$rect.Top
  width = [int]($rect.Right - $rect.Left)
  height = [int]($rect.Bottom - $rect.Top)
} | ConvertTo-Json -Compress
`;

  return parseActivationState(await runPowerShell(script));
}

export async function prepareGameWindowForReveal(
  window: GameWindowInfo,
  launchMode: GameLaunchMode = 'maximized'
): Promise<void> {
  const compensateFrameChrome = /^applicationframehost$/i.test(window.processName);
  await runActivationCommand(window.handle, launchMode, compensateFrameChrome, {
    foreground: false,
    topMost: false,
    applyBorderless: true
  });
}

export async function activateGameWindow(window: GameWindowInfo, launchMode: GameLaunchMode = 'maximized'): Promise<void> {
  const compensateFrameChrome = /^applicationframehost$/i.test(window.processName);
  let lastAttempt: GameWindowActivationState | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    lastAttempt = await runActivationCommand(window.handle, launchMode, compensateFrameChrome);
    if (
      lastAttempt &&
      lastAttempt.isForeground &&
      lastAttempt.isVisible &&
      !lastAttempt.isMinimized &&
      lastAttempt.width > 32 &&
      lastAttempt.height > 32
    ) {
      return;
    }
  }

  const state = lastAttempt
    ? `visible=${lastAttempt.isVisible}, minimized=${lastAttempt.isMinimized}, foreground=${lastAttempt.isForeground}, size=${lastAttempt.width}x${lastAttempt.height}`
    : 'no activation state returned';
  throw new Error(`Windows did not restore and focus the game window (${state}). NXGS Play stayed visible; try Resume Game again.`);
}

export async function keepGameWindowOnTop(
  window: GameWindowInfo,
  launchMode: GameLaunchMode = 'maximized'
): Promise<GameWindowActivationState | null> {
  const compensateFrameChrome = /^applicationframehost$/i.test(window.processName);
  return runActivationCommand(window.handle, launchMode, compensateFrameChrome, {
    foreground: true,
    topMost: true,
    applyBorderless: launchMode !== 'normal'
  });
}

export async function restoreGameWindow(window: GameWindowInfo, launchMode: GameLaunchMode = 'maximized'): Promise<void> {
  await activateGameWindow(window, launchMode);
}

export async function minimizeGameWindow(window: GameWindowInfo): Promise<void> {
  await runWindowCommand(window.handle, 'minimize');
}

export async function closeGameWindow(window: GameWindowInfo): Promise<void> {
  await runWindowCommand(window.handle, 'close');
}
