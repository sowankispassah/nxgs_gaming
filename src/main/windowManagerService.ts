import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import type { GameLaunchMode } from '../shared/types';
import { describeGamePresentation, isFullscreenGamePresentation } from './gamePresentation';
import { normalizeProcessName } from './windowsProcess';
import { runWindowsControl } from './windowsControlWorker';

const execFileAsync = promisify(execFile);
let desiredTaskbarVisible = true;
let taskbarVisibilityReconcile: Promise<void> | null = null;

export interface GameWindowInfo {
  handle: number;
  processId: number;
  processName: string;
  title: string;
  hostProcessId?: number;
  hostProcessName?: string;
  className?: string;
}

export interface GameWindowSearch {
  pid?: number;
  processName?: string;
  titleHint?: string;
  allowVerifiedShellHostedStoreFrame?: boolean;
}

type WindowCommand = 'foreground' | 'maximize' | 'restore' | 'minimize' | 'close';

interface ActivationOptions {
  foreground: boolean;
  topMost: boolean;
  applyBorderless: boolean;
  processActivate: boolean;
}

export interface GameWindowActivationState {
  foregroundHandle: number;
  hasWindowChrome: boolean;
  isForeground: boolean;
  isMinimized: boolean;
  isVisible: boolean;
  height: number;
  monitorHeight: number;
  monitorWidth: number;
  monitorX: number;
  monitorY: number;
  width: number;
  x: number;
  y: number;
}

export interface QuickOverlayZOrderState {
  error?: string;
  foregroundHandle: number;
  gameTopMost: boolean;
  gameVisible: boolean;
  overlayAboveGame: boolean;
  overlayForeground: boolean;
  overlayTopMost: boolean;
  overlayVisible: boolean;
}

function taskbarVisibilityScript(visible: boolean): string {
  const command = visible ? 5 : 0;
  return `
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
}

async function applyWindowsTaskbarVisibility(visible: boolean): Promise<void> {
  try {
    const result = await runWindowsControl('taskbar-visible', visible);
    if (result.ok) return;
  } catch {
    // Fall back to a standalone command if the warm native worker restarted.
  }
  await runPowerShell(taskbarVisibilityScript(visible));
}

export async function setWindowsTaskbarVisible(visible: boolean): Promise<void> {
  if (process.platform !== 'win32') return;

  desiredTaskbarVisible = visible;
  if (!taskbarVisibilityReconcile) {
    const operation = (async () => {
      while (true) {
        const target = desiredTaskbarVisible;
        await applyWindowsTaskbarVisibility(target);
        if (target === desiredTaskbarVisible) return;
      }
    })();
    taskbarVisibilityReconcile = operation;
    try {
      await operation;
    } finally {
      if (taskbarVisibilityReconcile === operation) {
        taskbarVisibilityReconcile = null;
      }
    }
    return;
  }

  await taskbarVisibilityReconcile;
}

export function restoreWindowsTaskbarSync(): void {
  if (process.platform !== 'win32') return;
  desiredTaskbarVisible = true;
  try {
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', taskbarVisibilityScript(true)],
      { windowsHide: true, timeout: 5000, stdio: 'ignore' }
    );
  } catch {
    // Best-effort last line of defense during process shutdown.
  }
}

export async function isWindowsTaskbarVisible(): Promise<boolean> {
  if (process.platform !== 'win32') {
    return false;
  }

  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class TaskbarVisibilityWin32 {
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr FindWindowEx(IntPtr hwndParent, IntPtr hwndChildAfter, string lpszClass, string lpszWindow);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
}
"@
$visible = $false
foreach ($class in @("Shell_TrayWnd", "Shell_SecondaryTrayWnd")) {
  $main = [TaskbarVisibilityWin32]::FindWindow($class, $null)
  if ($main -ne [IntPtr]::Zero -and [TaskbarVisibilityWin32]::IsWindowVisible($main)) { $visible = $true }
  $after = [IntPtr]::Zero
  while ($true) {
    $hwnd = [TaskbarVisibilityWin32]::FindWindowEx([IntPtr]::Zero, $after, $class, $null)
    if ($hwnd -eq [IntPtr]::Zero) { break }
    if ([TaskbarVisibilityWin32]::IsWindowVisible($hwnd)) { $visible = $true }
    $after = $hwnd
  }
}
if ($visible) { "true" } else { "false" }
`;
  return (await runPowerShell(script)).trim().toLowerCase() === 'true';
}

export async function sendEscapeKeyToGameWindow(window: GameWindowInfo): Promise<void> {
  if (process.platform !== 'win32' || !Number.isFinite(window.handle) || window.handle <= 0) {
    return;
  }
  const result = await runWindowsControl('escape', Math.trunc(window.handle));
  if (!result.ok) throw new Error(result.message);
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
      title: String(parsed.title ?? ''),
      hostProcessId: parsed.hostProcessId ? Number(parsed.hostProcessId) : undefined,
      hostProcessName: parsed.hostProcessName ? String(parsed.hostProcessName) : undefined,
      className: parsed.className ? String(parsed.className) : undefined
    };
  } catch {
    return null;
  }
}

export function isProvisionalShellHostedStoreWindow(window: GameWindowInfo): boolean {
  return (
    normalizeProcessName(window.hostProcessName ?? '') === 'explorer.exe' &&
    window.className === 'ApplicationFrameWindow' &&
    !window.title.trim()
  );
}

export async function getForegroundWindowInfo(): Promise<GameWindowInfo | null> {
  if (process.platform !== 'win32') return null;
  const script = `
$ErrorActionPreference = "SilentlyContinue"
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ForegroundWindowInfoWin32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder text, int maxCount);
}
"@
$hwnd = [ForegroundWindowInfoWin32]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) { exit }
[uint32]$windowProcessId = 0
[ForegroundWindowInfoWin32]::GetWindowThreadProcessId($hwnd, [ref]$windowProcessId) | Out-Null
$process = Get-Process -Id $windowProcessId
if (-not $process) { exit }
$title = New-Object System.Text.StringBuilder 1024
$className = New-Object System.Text.StringBuilder 256
[ForegroundWindowInfoWin32]::GetWindowText($hwnd, $title, $title.Capacity) | Out-Null
[ForegroundWindowInfoWin32]::GetClassName($hwnd, $className, $className.Capacity) | Out-Null
[pscustomobject]@{
  handle = [int64]$hwnd
  processId = [int]$windowProcessId
  processName = [string]$process.ProcessName
  hostProcessId = [int]$windowProcessId
  hostProcessName = [string]$process.ProcessName
  className = [string]$className.ToString()
  title = [string]$title.ToString()
} | ConvertTo-Json -Compress
`;
  return parseWindowInfo(await runPowerShell(script));
}

export async function findGameWindow(search: GameWindowSearch): Promise<GameWindowInfo | null> {
  if (process.platform !== 'win32') {
    return null;
  }

  const normalizedName = search.processName ? normalizeProcessName(search.processName).replace(/\.exe$/i, '') : '';
  const pid = Number.isFinite(search.pid) ? Number(search.pid) : 0;
  const titleHint = search.titleHint?.trim().toLowerCase() ?? '';
  const allowVerifiedShellHostedStoreFrame = Boolean(search.allowVerifiedShellHostedStoreFrame && pid > 0);
  const script = `
$ErrorActionPreference = "SilentlyContinue"
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class GameWindowSearchWin32 {
  public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hwnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out WindowRect rect);
}
public struct WindowRect { public int Left; public int Top; public int Right; public int Bottom; }
"@
$targetPid = ${pid}
$targetName = ${powershellQuote(normalizedName)}
$hint = ${powershellQuote(titleHint)}
$hintIdentity = $hint -replace '[^a-z0-9]', ''
$allowVerifiedShellHostedStoreFrame = ${allowVerifiedShellHostedStoreFrame ? '$true' : '$false'}
$targetProcess = if ($targetPid -gt 0) { Get-Process -Id $targetPid } else { $null }
$foregroundWindow = [GameWindowSearchWin32]::GetForegroundWindow()
$windows = New-Object System.Collections.Generic.List[object]
$callback = [GameWindowSearchWin32+EnumWindowsProc]{
  param([IntPtr]$hwnd, [IntPtr]$lParam)
  if (-not [GameWindowSearchWin32]::IsWindowVisible($hwnd)) { return $true }
  $length = [GameWindowSearchWin32]::GetWindowTextLength($hwnd)
  $text = New-Object System.Text.StringBuilder ([Math]::Max(2, $length + 1))
  if ($length -gt 0) {
    [GameWindowSearchWin32]::GetWindowText($hwnd, $text, $text.Capacity) | Out-Null
  }
  $title = $text.ToString()
  $classText = New-Object System.Text.StringBuilder 256
  [GameWindowSearchWin32]::GetClassName($hwnd, $classText, $classText.Capacity) | Out-Null
  $className = $classText.ToString()
  $rect = New-Object WindowRect
  [GameWindowSearchWin32]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  [uint32]$windowPid = 0
  [GameWindowSearchWin32]::GetWindowThreadProcessId($hwnd, [ref]$windowPid) | Out-Null
  $process = Get-Process -Id $windowPid
  if (-not $process) { return $true }
  $hostProcessName = $process.ProcessName
  $matchedProcessId = [int]$windowPid
  $matchedProcessName = [string]$process.ProcessName
  $descendantMatches = New-Object System.Collections.Generic.List[object]
  if (($targetPid -gt 0 -and $windowPid -ne $targetPid) -or $targetName -ne '') {
    $childCallback = [GameWindowSearchWin32+EnumWindowsProc]{
      param([IntPtr]$child, [IntPtr]$childParam)
      [uint32]$childPid = 0
      [GameWindowSearchWin32]::GetWindowThreadProcessId($child, [ref]$childPid) | Out-Null
      if ($childPid -eq 0 -or $childPid -eq $windowPid) { return $true }
      $childProcess = Get-Process -Id $childPid
      if (-not $childProcess) { return $true }
      $childName = $childProcess.ProcessName.ToLower()
      if (
        ($targetPid -gt 0 -and $childPid -eq $targetPid) -or
        ($targetName -ne '' -and $childName -eq $targetName)
      ) {
        $descendantMatches.Add([pscustomobject]@{
          processId = [int]$childPid
          processName = [string]$childProcess.ProcessName
        })
      }
      return $true
    }
    [GameWindowSearchWin32]::EnumChildWindows($hwnd, $childCallback, [IntPtr]::Zero) | Out-Null
  }
  $descendantMatch = $descendantMatches | Select-Object -First 1
  if ($descendantMatch) {
    $matchedProcessId = [int]$descendantMatch.processId
    $matchedProcessName = [string]$descendantMatch.processName
  }
  $processName = $matchedProcessName.ToLower()
  $processIdentity = $processName -replace '[^a-z0-9]', ''
  $titleLower = $title.ToLower()
  $titleMatchesHint = (
    $hint -ne "" -and
    ($titleLower -eq $hint -or $titleLower.Contains($hint))
  )
  $score = 99
  if ($targetPid -gt 0 -and $matchedProcessId -eq $targetPid) {
    # A Store process can briefly appear below multiple shell-host frames.
    # Prefer its titled/foreground frame over an older blank frame that happens
    # to contain another descendant from the same package process.
    if ($windowPid -eq $targetPid -or $titleMatchesHint) { $score = 0 }
    else { $score = 1 }
  }
  elseif ($targetName -ne "" -and $processName -eq $targetName) { $score = 1 }
  elseif (
    $titleMatchesHint -and
    (
      $processName -eq 'applicationframehost' -or
      ($processIdentity.Length -ge 4 -and ($processIdentity.Contains($hintIdentity) -or $hintIdentity.Contains($processIdentity)))
    )
  ) { $score = 2 }
  elseif (
    $allowVerifiedShellHostedStoreFrame -and
    $targetProcess -and
    $hostProcessName.ToLower() -eq 'explorer' -and
    $className -eq 'ApplicationFrameWindow' -and
    [string]::IsNullOrWhiteSpace($title)
  ) {
    # Current Windows builds can host a packaged game's composition surface in
    # an Explorer-owned ApplicationFrameWindow without exposing a child HWND.
    # Retain the exact package process identity and treat the shell only as host.
    $matchedProcessId = $targetPid
    $matchedProcessName = [string]$targetProcess.ProcessName
    $processName = $matchedProcessName.ToLower()
    $score = 3
  }
  $unsafeProcess = $processName -in @('brave', 'chatgpt', 'chrome', 'code', 'electron', 'explorer', 'firefox', 'msedge', 'nxgs play', 'opera')
  if ($score -lt 99 -and -not $unsafeProcess -and $width -gt 64 -and $height -gt 64) {
    $windows.Add([pscustomobject]@{
      handle = [int64]$hwnd
      processId = [int]$matchedProcessId
      processName = [string]$matchedProcessName
      hostProcessId = [int]$windowPid
      hostProcessName = [string]$hostProcessName
      className = [string]$className
      title = [string]$title
      score = $score
      foreground = [bool]($hwnd -eq $foregroundWindow)
      started = $process.StartTime
      order = $windows.Count
    })
  }
  return $true
}
[GameWindowSearchWin32]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
$shellHostedCandidates = @($windows | Where-Object { $_.score -eq 3 })
if ($shellHostedCandidates.Count -gt 1) {
  $foregroundShellHosted = @($shellHostedCandidates | Where-Object { $_.foreground })
  if ($foregroundShellHosted.Count -eq 1) {
    # The launch activation makes the selected Store frame foreground. Keep
    # that one exact HWND while discarding other untitled package frames.
    $foregroundHandle = $foregroundShellHosted[0].handle
    $windows = @($windows | Where-Object { $_.score -ne 3 -or $_.handle -eq $foregroundHandle })
  } else {
    # Without one foreground frame there is no safe identity discriminator.
    $windows = @($windows | Where-Object { $_.score -ne 3 })
  }
}
$selected = $windows |
  Sort-Object score, @{ Expression = { $_.foreground }; Descending = $true }, order, @{ Expression = { $_.started }; Descending = $true } |
  Select-Object -First 1
if ($selected) {
  [pscustomobject]@{
    handle = [int64]$selected.handle
    processId = [int]$selected.processId
    processName = [string]$selected.processName
    hostProcessId = [int]$selected.hostProcessId
    hostProcessName = [string]$selected.hostProcessName
    className = [string]$selected.className
    title = [string]$selected.title
  } | ConvertTo-Json -Compress
}
`;

  return parseWindowInfo(await runPowerShell(script));
}

export async function waitForGameWindow(
  search: GameWindowSearch,
  timeoutMs = 20000,
  fastIntervalMs = 125,
  settledIntervalMs = 250,
  shouldContinue: () => boolean = () => true
): Promise<GameWindowInfo | null> {
  const startedAt = Date.now();
  let provisionalWindow: GameWindowInfo | null = null;
  let provisionalDetectedAt = 0;
  while (Date.now() - startedAt < timeoutMs && shouldContinue()) {
    const window = await findGameWindow(search);
    if (!shouldContinue()) {
      return null;
    }
    if (window) {
      if (!isProvisionalShellHostedStoreWindow(window)) {
        return window;
      }
      provisionalWindow = window;
      provisionalDetectedAt ||= Date.now();
      // Explorer can publish a blank package frame several frames before
      // ApplicationFrameHost publishes the titled, capturable game frame.
      // Keep the verified package fallback, but give the real visual window a
      // bounded opportunity to appear instead of caching the blank shell.
      if (Date.now() - provisionalDetectedAt >= 2500) {
        return provisionalWindow;
      }
    }
    const elapsedMs = Date.now() - startedAt;
    const intervalMs = elapsedMs < 5000 ? fastIntervalMs : settledIntervalMs;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return provisionalWindow;
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
      hasWindowChrome: Boolean(parsed.hasWindowChrome),
      isForeground: Boolean(parsed.isForeground),
      isMinimized: Boolean(parsed.isMinimized),
      isVisible: Boolean(parsed.isVisible),
      height: Number(parsed.height ?? 0),
      monitorHeight: Number(parsed.monitorHeight ?? 0),
      monitorWidth: Number(parsed.monitorWidth ?? 0),
      monitorX: Number(parsed.monitorX ?? 0),
      monitorY: Number(parsed.monitorY ?? 0),
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
  const processActivate = options.processActivate ?? true;
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
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint dwFlags);
  [DllImport("user32.dll")] public static extern bool OpenIcon(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SetActiveWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
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
$useProcessActivate = ${processActivate ? '$true' : '$false'}
$useTopMost = ${topMost ? '$true' : '$false'}
$overscanPx = ${overscanPx}
$compensateFrameChrome = ${compensateFrameChrome ? '$true' : '$false'}
$gwlStyle = -16
$gwlExStyle = -20
$wsPopup = 0x80000000L
$wsVisible = 0x10000000L
$wsOverlappedWindow = 0x00CF0000L
$borderExStyles = 0x00000001L -bor 0x00000100L -bor 0x00000200L -bor 0x00020000L -bor 0x00040000L
[Win32]::AllowSetForegroundWindow(-1) | Out-Null
[Win32]::OpenIcon($hwnd) | Out-Null
[Win32]::ShowWindow($hwnd, 9) | Out-Null
Start-Sleep -Milliseconds 80
[Win32]::ShowWindowAsync($hwnd, 9) | Out-Null
if ($useBorderless) {
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
  $foregroundBefore = [Win32]::GetForegroundWindow()
  [uint32]$targetPid = 0
  [uint32]$foregroundPid = 0
  $currentThread = [Win32]::GetCurrentThreadId()
  $targetThread = [Win32]::GetWindowThreadProcessId($hwnd, [ref]$targetPid)
  $foregroundThread = [Win32]::GetWindowThreadProcessId($foregroundBefore, [ref]$foregroundPid)
  $attachedCurrent = $false
  $attachedForeground = $false
  try {
    if ($currentThread -ne $targetThread) {
      $attachedCurrent = [Win32]::AttachThreadInput($currentThread, $targetThread, $true)
    }
    if ($foregroundThread -ne 0 -and $foregroundThread -ne $targetThread) {
      $attachedForeground = [Win32]::AttachThreadInput($foregroundThread, $targetThread, $true)
    }
    if ($useProcessActivate) {
      [Win32]::AllowSetForegroundWindow([int]$targetPid) | Out-Null
    }
    [Win32]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
    if ($useProcessActivate) {
      [Win32]::SwitchToThisWindow($hwnd, $true)
    }
    [Win32]::BringWindowToTop($hwnd) | Out-Null
    [Win32]::SetActiveWindow($hwnd) | Out-Null
    [Win32]::SetForegroundWindow($hwnd) | Out-Null
    [Win32]::SetFocus($hwnd) | Out-Null
    [Win32]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    if ($useProcessActivate) {
      try {
      $shell = New-Object -ComObject WScript.Shell
      $shell.AppActivate([int]$targetPid) | Out-Null
      [Win32]::SetForegroundWindow($hwnd) | Out-Null
      } catch {}
    }
  } finally {
    [Win32]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    if ($attachedForeground) {
      [Win32]::AttachThreadInput($foregroundThread, $targetThread, $false) | Out-Null
    }
    if ($attachedCurrent) {
      [Win32]::AttachThreadInput($currentThread, $targetThread, $false) | Out-Null
    }
  }
}
Start-Sleep -Milliseconds 160
$foreground = [Win32]::GetForegroundWindow()
$rect = New-Object RECT
[Win32]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$finalStyle = [Win32]::GetWindowLongPtr($hwnd, $gwlStyle).ToInt64()
$finalExStyle = [Win32]::GetWindowLongPtr($hwnd, $gwlExStyle).ToInt64()
$hasWindowChrome = (($finalStyle -band $wsOverlappedWindow) -ne 0) -or (($finalExStyle -band $borderExStyles) -ne 0)
$finalMonitor = [Win32]::MonitorFromWindow($hwnd, 2)
$finalMonitorInfo = New-Object MONITORINFO
$finalMonitorInfo.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([type][MONITORINFO])
$hasMonitorInfo = [Win32]::GetMonitorInfo($finalMonitor, [ref]$finalMonitorInfo)
[pscustomobject]@{
  foregroundHandle = [int64]$foreground
  hasWindowChrome = [bool]$hasWindowChrome
  isForeground = ($foreground -eq $hwnd)
  isMinimized = [Win32]::IsIconic($hwnd)
  isVisible = [Win32]::IsWindowVisible($hwnd)
  x = [int]$rect.Left
  y = [int]$rect.Top
  width = [int]($rect.Right - $rect.Left)
  height = [int]($rect.Bottom - $rect.Top)
  monitorX = if ($hasMonitorInfo) { [int]$finalMonitorInfo.rcMonitor.Left } else { 0 }
  monitorY = if ($hasMonitorInfo) { [int]$finalMonitorInfo.rcMonitor.Top } else { 0 }
  monitorWidth = if ($hasMonitorInfo) { [int]($finalMonitorInfo.rcMonitor.Right - $finalMonitorInfo.rcMonitor.Left) } else { 0 }
  monitorHeight = if ($hasMonitorInfo) { [int]($finalMonitorInfo.rcMonitor.Bottom - $finalMonitorInfo.rcMonitor.Top) } else { 0 }
} | ConvertTo-Json -Compress
`;

  return parseActivationState(await runPowerShell(script));
}

export async function activateLauncherWindow(handle: number): Promise<boolean> {
  const state = await runActivationCommand(handle, 'normal', false, {
    foreground: true,
    topMost: true,
    applyBorderless: false,
    processActivate: true
  });
  return Boolean(state?.isForeground);
}

export async function prepareGameWindowForReveal(
  window: GameWindowInfo,
  launchMode: GameLaunchMode = 'maximized'
): Promise<void> {
  const compensateFrameChrome = isApplicationFrameHostWindow(window);
  await runActivationCommand(window.handle, launchMode, compensateFrameChrome, {
    foreground: false,
    topMost: false,
    applyBorderless: true,
    processActivate: !isShellHostedStoreFrame(window)
  });
}

export async function activateGameWindow(window: GameWindowInfo, launchMode: GameLaunchMode = 'maximized'): Promise<void> {
  const compensateFrameChrome = isApplicationFrameHostWindow(window);
  let lastAttempt: GameWindowActivationState | null = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    lastAttempt = await runActivationCommand(window.handle, launchMode, compensateFrameChrome, {
      processActivate: !isShellHostedStoreFrame(window)
    });
    if (isFullscreenGamePresentation(lastAttempt)) {
      return;
    }
    if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 180));
  }

  throw new Error(
    `NXGS could not establish protected fullscreen gameplay (${describeGamePresentation(lastAttempt)}). ` +
      'The session remains unresolved; try Resume Game again.'
  );
}

export async function keepGameWindowOnTop(
  window: GameWindowInfo,
  launchMode: GameLaunchMode = 'maximized'
): Promise<GameWindowActivationState | null> {
  const compensateFrameChrome = isApplicationFrameHostWindow(window);
  return runActivationCommand(window.handle, launchMode, compensateFrameChrome, {
    foreground: true,
    topMost: true,
    applyBorderless: launchMode !== 'normal',
    processActivate: !isShellHostedStoreFrame(window)
  });
}

export async function getRootWindowHandle(handle: number): Promise<number> {
  if (process.platform !== 'win32' || !Number.isFinite(handle) || handle <= 0) {
    return 0;
  }
  const safeHandle = Math.trunc(handle);
  const script = `
$ErrorActionPreference = "Stop"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class RootWindowWin32 {
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
}
"@
$window = [IntPtr]${safeHandle}
if (-not [RootWindowWin32]::IsWindow($window)) { "0"; exit }
$root = [RootWindowWin32]::GetAncestor($window, 2)
if ($root -eq [IntPtr]::Zero) { $root = $window }
[int64]$root
`;
  try {
    const root = Number(await runPowerShell(script));
    return Number.isFinite(root) && root > 0 ? Math.trunc(root) : safeHandle;
  } catch {
    return safeHandle;
  }
}

export async function getWindowCaptureTopInset(handle: number): Promise<number> {
  if (process.platform !== 'win32' || !Number.isFinite(handle) || handle <= 0) {
    return 0;
  }
  const safeHandle = Math.trunc(handle);
  const script = `
$ErrorActionPreference = "Stop"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public struct CaptureInsetPoint { public int X; public int Y; }
public struct CaptureInsetRect { public int Left; public int Top; public int Right; public int Bottom; }
[StructLayout(LayoutKind.Sequential)]
public struct CaptureInsetMonitorInfo {
  public uint cbSize;
  public CaptureInsetRect rcMonitor;
  public CaptureInsetRect rcWork;
  public uint dwFlags;
}
public static class CaptureInsetWin32 {
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hwnd, ref CaptureInsetPoint point);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd, out CaptureInsetRect rect);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr monitor, ref CaptureInsetMonitorInfo info);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out CaptureInsetRect rect);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
}
"@
$window = [IntPtr]${safeHandle}
if (-not [CaptureInsetWin32]::IsWindow($window)) { "0"; exit }
$windowRect = New-Object CaptureInsetRect
$clientRect = New-Object CaptureInsetRect
$clientOrigin = New-Object CaptureInsetPoint
if (
  -not [CaptureInsetWin32]::GetWindowRect($window, [ref]$windowRect) -or
  -not [CaptureInsetWin32]::GetClientRect($window, [ref]$clientRect) -or
  -not [CaptureInsetWin32]::ClientToScreen($window, [ref]$clientOrigin)
) { "0"; exit }
$clientInset = [Math]::Max(0, $clientOrigin.Y - $windowRect.Top)
$monitor = [CaptureInsetWin32]::MonitorFromWindow($window, 2)
$monitorInfo = New-Object CaptureInsetMonitorInfo
$monitorInfo.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([type][CaptureInsetMonitorInfo])
$offscreenInset = 0
if ($monitor -ne [IntPtr]::Zero -and [CaptureInsetWin32]::GetMonitorInfo($monitor, [ref]$monitorInfo)) {
  $offscreenInset = [Math]::Max(0, $monitorInfo.rcMonitor.Top - $windowRect.Top)
}
$topInset = [Math]::Max($clientInset, $offscreenInset)
[Math]::Min(160, $topInset)
`;
  try {
    return Number((await runPowerShell(script)).trim()) || 0;
  } catch {
    return 0;
  }
}

export async function enforceQuickOverlayZOrder(
  overlayHandle: number,
  gameHandle?: number,
  minimizeGameAfterPaint = false
): Promise<QuickOverlayZOrderState | null> {
  if (process.platform !== 'win32' || !Number.isFinite(overlayHandle) || overlayHandle <= 0) {
    return null;
  }

  const safeOverlayHandle = Math.trunc(overlayHandle);
  const safeGameHandle = Number.isFinite(gameHandle) && Number(gameHandle) > 0
    ? Math.trunc(Number(gameHandle))
    : 0;
  let lastState: QuickOverlayZOrderState | null = null;

  try {
    const staged = await runWindowsControl('stage-overlay', {
      overlayHandle: safeOverlayHandle,
      gameHandle: safeGameHandle,
      minimizeGameAfterPaint
    });
    // The warm native worker keeps Home input deterministic. In particular,
    // do not make a failed Store-frame attempt wait for a new PowerShell
    // process before the caller can switch to the safe recovery path.
    return {
      error: staged.ok ? undefined : staged.message,
      foregroundHandle: staged.ok ? safeOverlayHandle : 0,
      gameTopMost: staged.ok && safeGameHandle > 0 && !minimizeGameAfterPaint,
      gameVisible: safeGameHandle > 0 && !minimizeGameAfterPaint,
      overlayAboveGame: staged.ok,
      overlayForeground: staged.ok && !minimizeGameAfterPaint,
      overlayTopMost: staged.ok,
      overlayVisible: staged.ok
    };
  } catch {
    // Retain the standalone path as a recovery if the warm worker restarted.
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const script = `
$ErrorActionPreference = "Stop"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class QuickOverlayZOrderWin32 {
  [DllImport("dwmapi.dll")] public static extern int DwmFlush();
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(uint processId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SetActiveWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint action, uint param, ref uint value, uint flags);
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool altTab);
  [DllImport("user32.dll")] public static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
  [DllImport("user32.dll", EntryPoint="GetWindowLong")] public static extern int GetWindowLong32(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtr")] public static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);
  public static IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex) {
    if (IntPtr.Size == 8) return GetWindowLongPtr64(hWnd, nIndex);
    return new IntPtr(GetWindowLong32(hWnd, nIndex));
  }
}
"@
$overlay = [IntPtr]${safeOverlayHandle}
$game = [IntPtr]${safeGameHandle}
$minimizeGameAfterPaint = ${minimizeGameAfterPaint ? '$true' : '$false'}
$topMost = [IntPtr](-1)
$notTopMost = [IntPtr](-2)
$noMoveNoSizeShowNoActivate = 0x0001 -bor 0x0002 -bor 0x0010 -bor 0x0040
$noMoveNoSizeShow = 0x0001 -bor 0x0002 -bor 0x0040
$gwlExStyle = -20
$wsExTopMost = 0x00000008L
$gwHwndPrev = 3

if (-not [QuickOverlayZOrderWin32]::IsWindow($overlay)) { throw "Overlay HWND is invalid." }
if (
  -not $minimizeGameAfterPaint -and
  $game -ne [IntPtr]::Zero -and
  [QuickOverlayZOrderWin32]::IsWindow($game)
) {
  [QuickOverlayZOrderWin32]::ShowWindow($game, 9) | Out-Null
  # Stage the exact tracked game at the front of the topmost band first, then
  # place NXGS immediately above it. Transparent pixels can therefore reveal
  # only the running game—never Chrome, Explorer, or another open app.
  [QuickOverlayZOrderWin32]::SetWindowPos($game, $topMost, 0, 0, 0, 0, $noMoveNoSizeShowNoActivate) | Out-Null
}
[QuickOverlayZOrderWin32]::ShowWindow($overlay, 5) | Out-Null
[QuickOverlayZOrderWin32]::SetWindowPos($overlay, $topMost, 0, 0, 0, 0, $noMoveNoSizeShow) | Out-Null
if (
  $minimizeGameAfterPaint -and
  $game -ne [IntPtr]::Zero -and
  [QuickOverlayZOrderWin32]::IsWindow($game)
) {
  [QuickOverlayZOrderWin32]::DwmFlush() | Out-Null
  [QuickOverlayZOrderWin32]::SetWindowPos($game, $notTopMost, 0, 0, 0, 0, $noMoveNoSizeShowNoActivate) | Out-Null
  [QuickOverlayZOrderWin32]::ShowWindow($game, 6) | Out-Null
  for ($wait = 0; $wait -lt 30 -and -not [QuickOverlayZOrderWin32]::IsIconic($game); $wait += 1) {
    Start-Sleep -Milliseconds 15
  }
}

# SetForegroundWindow alone is allowed to fail when a game or unrelated app
# owns the foreground lock. Join the relevant input queues for this short,
# bounded transaction so the NXGS overlay—not Chrome or the launcher—becomes
# the real keyboard/controller target.
$callerThread = [QuickOverlayZOrderWin32]::GetCurrentThreadId()
$foregroundBefore = [QuickOverlayZOrderWin32]::GetForegroundWindow()
$foregroundProcess = [uint32]0
$overlayProcess = [uint32]0
$foregroundThread = if ($foregroundBefore -ne [IntPtr]::Zero) {
  [QuickOverlayZOrderWin32]::GetWindowThreadProcessId($foregroundBefore, [ref]$foregroundProcess)
} else { 0 }
$overlayThread = [QuickOverlayZOrderWin32]::GetWindowThreadProcessId($overlay, [ref]$overlayProcess)
$attachedForeground = $false
$attachedOverlay = $false
$attachedOverlayToForeground = $false
$foregroundLockTimeout = [uint32]0
$foregroundLockTimeoutRead = [QuickOverlayZOrderWin32]::SystemParametersInfo(0x2000, 0, [ref]$foregroundLockTimeout, 0)
try {
  if ($foregroundThread -ne 0 -and $foregroundThread -ne $callerThread) {
    $attachedForeground = [QuickOverlayZOrderWin32]::AttachThreadInput($callerThread, $foregroundThread, $true)
  }
  if ($overlayThread -ne 0 -and $overlayThread -ne $callerThread) {
    $attachedOverlay = [QuickOverlayZOrderWin32]::AttachThreadInput($callerThread, $overlayThread, $true)
  }
  if ($overlayThread -ne 0 -and $foregroundThread -ne 0 -and $overlayThread -ne $foregroundThread) {
    $attachedOverlayToForeground = [QuickOverlayZOrderWin32]::AttachThreadInput($overlayThread, $foregroundThread, $true)
  }
  $unlockedTimeout = [uint32]0
  [QuickOverlayZOrderWin32]::SystemParametersInfo(0x2001, 0, [ref]$unlockedTimeout, 0) | Out-Null
  [QuickOverlayZOrderWin32]::AllowSetForegroundWindow([uint32]::MaxValue) | Out-Null
  # A synthetic, modifier-only Alt transition marks this foreground handoff as
  # user-authorized without producing text or changing the game state.
  [QuickOverlayZOrderWin32]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
  [QuickOverlayZOrderWin32]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  [QuickOverlayZOrderWin32]::BringWindowToTop($overlay) | Out-Null
  [QuickOverlayZOrderWin32]::SetForegroundWindow($overlay) | Out-Null
  [QuickOverlayZOrderWin32]::SetActiveWindow($overlay) | Out-Null
  [QuickOverlayZOrderWin32]::SetFocus($overlay) | Out-Null
  if ([QuickOverlayZOrderWin32]::GetForegroundWindow() -ne $overlay) {
    [QuickOverlayZOrderWin32]::SwitchToThisWindow($overlay, $true)
  }
} finally {
  if ($foregroundLockTimeoutRead) {
    [QuickOverlayZOrderWin32]::SystemParametersInfo(0x2001, 0, [ref]$foregroundLockTimeout, 0) | Out-Null
  }
  if ($attachedOverlayToForeground) {
    [QuickOverlayZOrderWin32]::AttachThreadInput($overlayThread, $foregroundThread, $false) | Out-Null
  }
  if ($attachedOverlay) {
    [QuickOverlayZOrderWin32]::AttachThreadInput($callerThread, $overlayThread, $false) | Out-Null
  }
  if ($attachedForeground) {
    [QuickOverlayZOrderWin32]::AttachThreadInput($callerThread, $foregroundThread, $false) | Out-Null
  }
}

$gameMinimized = $game -ne [IntPtr]::Zero -and
  [QuickOverlayZOrderWin32]::IsWindow($game) -and
  [QuickOverlayZOrderWin32]::IsIconic($game)
$overlayAboveGame = [bool]($minimizeGameAfterPaint -and $gameMinimized)
if (
  -not $overlayAboveGame -and
  $game -ne [IntPtr]::Zero -and
  [QuickOverlayZOrderWin32]::IsWindow($game)
) {
  $overlayAboveGame = $false
  $cursor = [QuickOverlayZOrderWin32]::GetWindow($game, $gwHwndPrev)
  $guard = 0
  while ($cursor -ne [IntPtr]::Zero -and $guard -lt 4096) {
    if ($cursor -eq $overlay) {
      $overlayAboveGame = $true
      break
    }
    $cursor = [QuickOverlayZOrderWin32]::GetWindow($cursor, $gwHwndPrev)
    $guard += 1
  }
}

$overlayExStyle = [QuickOverlayZOrderWin32]::GetWindowLongPtr($overlay, $gwlExStyle).ToInt64()
$gameExStyle = if ($game -ne [IntPtr]::Zero -and [QuickOverlayZOrderWin32]::IsWindow($game)) {
  [QuickOverlayZOrderWin32]::GetWindowLongPtr($game, $gwlExStyle).ToInt64()
} else { 0 }
$foregroundAfter = [QuickOverlayZOrderWin32]::GetForegroundWindow()
[pscustomobject]@{
  foregroundHandle = [int64]$foregroundAfter
  gameTopMost = [bool](($gameExStyle -band $wsExTopMost) -ne 0)
  gameVisible = [bool](
    $game -ne [IntPtr]::Zero -and
    [QuickOverlayZOrderWin32]::IsWindowVisible($game) -and
    -not $gameMinimized
  )
  overlayAboveGame = [bool]$overlayAboveGame
  overlayForeground = [bool]($foregroundAfter -eq $overlay)
  overlayTopMost = [bool](($overlayExStyle -band $wsExTopMost) -ne 0)
  overlayVisible = [bool][QuickOverlayZOrderWin32]::IsWindowVisible($overlay)
} | ConvertTo-Json -Compress
`;
    try {
      const parsed = JSON.parse(await runPowerShell(script)) as QuickOverlayZOrderState;
      lastState = {
        foregroundHandle: Number(parsed.foregroundHandle) || 0,
        gameTopMost: Boolean(parsed.gameTopMost),
        gameVisible: Boolean(parsed.gameVisible),
        overlayAboveGame: Boolean(parsed.overlayAboveGame),
        overlayForeground: Boolean(parsed.overlayForeground),
        overlayTopMost: Boolean(parsed.overlayTopMost),
        overlayVisible: Boolean(parsed.overlayVisible)
      };
      if (
        lastState.overlayVisible &&
        lastState.overlayTopMost &&
        lastState.overlayAboveGame &&
        lastState.overlayForeground
      ) {
        return lastState;
      }
    } catch {
      lastState = null;
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 60));
  }

  return lastState;
}

export async function releaseGameWindowTopMost(window: GameWindowInfo): Promise<void> {
  if (process.platform !== 'win32' || !Number.isFinite(window.handle) || window.handle <= 0) {
    return;
  }
  try {
    const result = await runWindowsControl('release-window', Math.trunc(window.handle));
    if (result.ok) return;
  } catch {
    // Fall back to the standalone native command below if the warm worker restarted.
  }
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class QuickOverlayWin32 {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint flags);
}
"@
$hwnd = [IntPtr]${Math.trunc(window.handle)}
$notTopMost = [IntPtr](-2)
$flags = 0x0001 -bor 0x0002 -bor 0x0010 -bor 0x0040
[QuickOverlayWin32]::SetWindowPos($hwnd, $notTopMost, 0, 0, 0, 0, $flags) | Out-Null
`;
  await runPowerShell(script);
}

export async function isGameWindowVisible(window: GameWindowInfo): Promise<boolean> {
  if (process.platform !== 'win32' || !Number.isFinite(window.handle) || window.handle <= 0) {
    return false;
  }
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public struct QuickWindowRect { public int Left; public int Top; public int Right; public int Bottom; }
public static class QuickWindowStateWin32 {
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out QuickWindowRect rect);
}
"@
$hwnd = [IntPtr]${Math.trunc(window.handle)}
$rect = New-Object QuickWindowRect
$hasRect = [QuickWindowStateWin32]::GetWindowRect($hwnd, [ref]$rect)
$width = if ($hasRect) { $rect.Right - $rect.Left } else { 0 }
$height = if ($hasRect) { $rect.Bottom - $rect.Top } else { 0 }
if ([QuickWindowStateWin32]::IsWindow($hwnd) -and [QuickWindowStateWin32]::IsWindowVisible($hwnd) -and $width -gt 32 -and $height -gt 32) { "true" } else { "false" }
`;
  return (await runPowerShell(script)).trim().toLowerCase() === 'true';
}

export async function getGameWindowActivationState(
  window: GameWindowInfo
): Promise<GameWindowActivationState | null> {
  if (process.platform !== 'win32' || !Number.isFinite(window.handle) || window.handle <= 0) {
    return null;
  }
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public struct InspectWindowRect { public int Left; public int Top; public int Right; public int Bottom; }
public struct InspectMonitorInfo {
  public int cbSize;
  public InspectWindowRect rcMonitor;
  public InspectWindowRect rcWork;
  public uint dwFlags;
}
public static class InspectGameWindowWin32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr monitor, ref InspectMonitorInfo info);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out InspectWindowRect rect);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
  [DllImport("user32.dll", EntryPoint="GetWindowLong")] public static extern int GetWindowLong32(IntPtr hwnd, int index);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtr")] public static extern IntPtr GetWindowLongPtr64(IntPtr hwnd, int index);
  public static IntPtr GetWindowLongPtr(IntPtr hwnd, int index) {
    if (IntPtr.Size == 8) return GetWindowLongPtr64(hwnd, index);
    return new IntPtr(GetWindowLong32(hwnd, index));
  }
}
"@
$hwnd = [IntPtr]${Math.trunc(window.handle)}
$foreground = [InspectGameWindowWin32]::GetForegroundWindow()
$rect = New-Object InspectWindowRect
[InspectGameWindowWin32]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$monitor = [InspectGameWindowWin32]::MonitorFromWindow($hwnd, 2)
$monitorInfo = New-Object InspectMonitorInfo
$monitorInfo.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([type][InspectMonitorInfo])
$hasMonitorInfo = [InspectGameWindowWin32]::GetMonitorInfo($monitor, [ref]$monitorInfo)
$style = [InspectGameWindowWin32]::GetWindowLongPtr($hwnd, -16).ToInt64()
$exStyle = [InspectGameWindowWin32]::GetWindowLongPtr($hwnd, -20).ToInt64()
$wsOverlappedWindow = 0x00CF0000L
$borderExStyles = 0x00000001L -bor 0x00000100L -bor 0x00000200L -bor 0x00020000L -bor 0x00040000L
$hasWindowChrome = (($style -band $wsOverlappedWindow) -ne 0) -or (($exStyle -band $borderExStyles) -ne 0)
[pscustomobject]@{
  foregroundHandle = [int64]$foreground
  hasWindowChrome = [bool]$hasWindowChrome
  isForeground = ($foreground -eq $hwnd)
  isMinimized = [InspectGameWindowWin32]::IsIconic($hwnd)
  isVisible = [InspectGameWindowWin32]::IsWindowVisible($hwnd)
  x = [int]$rect.Left
  y = [int]$rect.Top
  width = [int]($rect.Right - $rect.Left)
  height = [int]($rect.Bottom - $rect.Top)
  monitorX = if ($hasMonitorInfo) { [int]$monitorInfo.rcMonitor.Left } else { 0 }
  monitorY = if ($hasMonitorInfo) { [int]$monitorInfo.rcMonitor.Top } else { 0 }
  monitorWidth = if ($hasMonitorInfo) { [int]($monitorInfo.rcMonitor.Right - $monitorInfo.rcMonitor.Left) } else { 0 }
  monitorHeight = if ($hasMonitorInfo) { [int]($monitorInfo.rcMonitor.Bottom - $monitorInfo.rcMonitor.Top) } else { 0 }
} | ConvertTo-Json -Compress
`;
  return parseActivationState(await runPowerShell(script));
}

export async function resumeGameWindowFast(
  window: GameWindowInfo,
  launchMode: GameLaunchMode = 'maximized'
): Promise<GameWindowActivationState | null> {
  try {
    const result = await runWindowsControl('focus-window', Math.trunc(window.handle));
    if (result.ok && result.value === true) {
      return {
        foregroundHandle: window.handle,
        hasWindowChrome: false,
        isForeground: true,
        isMinimized: false,
        isVisible: true,
        height: 0,
        monitorHeight: 0,
        monitorWidth: 0,
        monitorX: 0,
        monitorY: 0,
        width: 0,
        x: 0,
        y: 0
      };
    }
  } catch {
    // Use the full presentation command when the persistent worker is unavailable.
  }
  const compensateFrameChrome = isApplicationFrameHostWindow(window);
  return runActivationCommand(window.handle, launchMode, compensateFrameChrome, {
    foreground: true,
    topMost: true,
    applyBorderless: launchMode !== 'normal',
    processActivate: !isShellHostedStoreFrame(window)
  });
}

export async function restoreGameWindow(window: GameWindowInfo, launchMode: GameLaunchMode = 'maximized'): Promise<void> {
  await activateGameWindow(window, launchMode);
}

export async function minimizeGameWindow(window: GameWindowInfo): Promise<void> {
  await runWindowCommand(window.handle, 'minimize');
}

export async function closeGameWindow(window: GameWindowInfo): Promise<void> {
  try {
    const result = await runWindowsControl('close-window', Math.trunc(window.handle));
    if (result.ok) return;
  } catch {
    // Fall back to the legacy close command if the persistent worker restarted.
  }
  await runWindowCommand(window.handle, 'close');
}

function isShellHostedStoreFrame(window: GameWindowInfo): boolean {
  const hostProcessName = window.hostProcessName || window.processName;
  return /^applicationframehost$/i.test(hostProcessName) ||
    (/^explorer$/i.test(hostProcessName) && !window.title.trim());
}

function isApplicationFrameHostWindow(window: GameWindowInfo): boolean {
  return /^applicationframehost$/i.test(window.hostProcessName || window.processName);
}
