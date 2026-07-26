import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export type WindowsControlCommand =
  | 'volume'
  | 'mute'
  | 'brightness'
  | 'escape'
  | 'focus-window'
  | 'release-window'
  | 'close-window';

export interface WindowsControlResult {
  ok: boolean;
  value?: number | boolean;
  message: string;
}

type PendingRequest = {
  resolve: (result: WindowsControlResult) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

const WORKER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class NxgsLiveAudio {
    private enum EDataFlow { Render = 0, Capture = 1, All = 2 }
    private enum ERole { Console = 0, Multimedia = 1, Communications = 2 }

    [ComImport]
    [Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class MMDeviceEnumeratorComObject { }

    [ComImport]
    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator {
        [PreserveSig] int EnumAudioEndpoints(EDataFlow dataFlow, uint stateMask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice device);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr callback);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr callback);
    }

    [ComImport]
    [Guid("D666063F-1587-4E43-81F1-B948E807363F")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice {
        [PreserveSig] int Activate(ref Guid iid, uint context, IntPtr activationParameters, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
        [PreserveSig] int OpenPropertyStore(uint access, out IntPtr properties);
        [PreserveSig] int GetId(out IntPtr id);
        [PreserveSig] int GetState(out uint state);
    }

    [ComImport]
    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioEndpointVolume {
        [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int GetChannelCount(out uint channelCount);
        [PreserveSig] int SetMasterVolumeLevel(float levelDb, ref Guid eventContext);
        [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid eventContext);
        [PreserveSig] int GetMasterVolumeLevel(out float levelDb);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
        [PreserveSig] int SetChannelVolumeLevel(uint channel, float levelDb, ref Guid eventContext);
        [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid eventContext);
        [PreserveSig] int GetChannelVolumeLevel(uint channel, out float levelDb);
        [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool muted, ref Guid eventContext);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool muted);
        [PreserveSig] int GetVolumeStepInfo(out uint step, out uint stepCount);
        [PreserveSig] int VolumeStepUp(ref Guid eventContext);
        [PreserveSig] int VolumeStepDown(ref Guid eventContext);
        [PreserveSig] int QueryHardwareSupport(out uint hardwareSupportMask);
        [PreserveSig] int GetVolumeRange(out float minimumDb, out float maximumDb, out float incrementDb);
    }

    private const uint ClsCtxAll = 23;
    private static readonly Guid EndpointVolumeId = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");

    private static void Ensure(int result) {
        if (result != 0) Marshal.ThrowExceptionForHR(result, new IntPtr(-1));
    }

    private static IAudioEndpointVolume OpenEndpoint(out IMMDevice device, out IMMDeviceEnumerator enumerator) {
        enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        Ensure(enumerator.GetDefaultAudioEndpoint(EDataFlow.Render, ERole.Multimedia, out device));
        object instance;
        var iid = EndpointVolumeId;
        Ensure(device.Activate(ref iid, ClsCtxAll, IntPtr.Zero, out instance));
        return (IAudioEndpointVolume)instance;
    }

    public static void SetVolume(int volume) {
        IMMDevice device;
        IMMDeviceEnumerator enumerator;
        var endpoint = OpenEndpoint(out device, out enumerator);
        try {
            var context = Guid.Empty;
            Ensure(endpoint.SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, volume)) / 100f, ref context));
        } finally {
            Marshal.ReleaseComObject(endpoint);
            Marshal.ReleaseComObject(device);
            Marshal.ReleaseComObject(enumerator);
        }
    }

    public static void SetMute(bool muted) {
        IMMDevice device;
        IMMDeviceEnumerator enumerator;
        var endpoint = OpenEndpoint(out device, out enumerator);
        try {
            var context = Guid.Empty;
            Ensure(endpoint.SetMute(muted, ref context));
        } finally {
            Marshal.ReleaseComObject(endpoint);
            Marshal.ReleaseComObject(device);
            Marshal.ReleaseComObject(enumerator);
        }
    }
}

public static class NxgsWarningInput {
    [DllImport("user32.dll")] private static extern bool AllowSetForegroundWindow(int processId);
    [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint attach, uint attachTo, bool attachState);
    [DllImport("user32.dll")] private static extern bool BringWindowToTop(IntPtr window);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern IntPtr SetActiveWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr SetFocus(IntPtr window);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr window, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr window, int command);

    private const uint KeyUp = 0x0002;
    private const uint NoSize = 0x0001;
    private const uint NoMove = 0x0002;
    private const uint NoActivate = 0x0010;
    private const uint ShowWindowFlag = 0x0040;
    private const uint WindowClose = 0x0010;

    public static bool FocusWindow(long handle) {
        var window = new IntPtr(handle);
        if (window == IntPtr.Zero || !IsWindow(window)) return false;
        AllowSetForegroundWindow(-1);
        ShowWindowAsync(window, 9);
        SetWindowPos(window, new IntPtr(-1), 0, 0, 0, 0, NoSize | NoMove | ShowWindowFlag);
        SetForegroundWindow(window);
        return GetForegroundWindow() == window;
    }

    public static bool ReleaseWindow(long handle) {
        var window = new IntPtr(handle);
        return window != IntPtr.Zero && IsWindow(window) &&
            SetWindowPos(window, new IntPtr(-2), 0, 0, 0, 0, NoSize | NoMove | NoActivate);
    }

    public static bool CloseWindow(long handle) {
        var window = new IntPtr(handle);
        return window != IntPtr.Zero && IsWindow(window) &&
            PostMessage(window, WindowClose, IntPtr.Zero, IntPtr.Zero);
    }

    public static string SendEscape(long handle) {
        var window = new IntPtr(handle);
        if (window == IntPtr.Zero || !IsWindow(window)) return "invalid_window";
        uint targetProcess;
        var targetThread = GetWindowThreadProcessId(window, out targetProcess);
        var currentThread = GetCurrentThreadId();
        var foreground = GetForegroundWindow();
        uint foregroundProcess = 0;
        var foregroundThread = foreground == IntPtr.Zero ? 0 : GetWindowThreadProcessId(foreground, out foregroundProcess);
        var attachedCurrent = false;
        var attachedForeground = false;
        try {
            if (currentThread != targetThread) attachedCurrent = AttachThreadInput(currentThread, targetThread, true);
            if (foregroundThread != 0 && foregroundThread != targetThread) {
                attachedForeground = AttachThreadInput(foregroundThread, targetThread, true);
            }
            AllowSetForegroundWindow(-1);
            ShowWindowAsync(window, 9);
            keybd_event(0x12, 0, 0, UIntPtr.Zero);
            BringWindowToTop(window);
            SetActiveWindow(window);
            SetForegroundWindow(window);
            SetFocus(window);
            keybd_event(0x12, 0, KeyUp, UIntPtr.Zero);
            System.Threading.Thread.Sleep(45);
            if (GetForegroundWindow() != window) {
                SetForegroundWindow(window);
                SetFocus(window);
                System.Threading.Thread.Sleep(45);
            }
            if (GetForegroundWindow() != window) return "focus_failed:" + GetForegroundWindow().ToInt64();
            keybd_event(0x1B, 0x01, 0, UIntPtr.Zero);
            System.Threading.Thread.Sleep(55);
            keybd_event(0x1B, 0x01, KeyUp, UIntPtr.Zero);
            return "ok";
        } finally {
            keybd_event(0x12, 0, KeyUp, UIntPtr.Zero);
            if (attachedForeground) AttachThreadInput(foregroundThread, targetThread, false);
            if (attachedCurrent) AttachThreadInput(currentThread, targetThread, false);
        }
    }
}
'@ | Out-Null

while (($line = [Console]::In.ReadLine()) -ne $null) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $request = $null
    try {
        $request = $line | ConvertFrom-Json
        if ($request.command -eq 'volume') {
            $value = [Math]::Max(0, [Math]::Min(100, [int]$request.value))
            [NxgsLiveAudio]::SetVolume($value)
            $response = @{ id = $request.id; ok = $true; value = $value; message = "System volume changed to $value%." }
        } elseif ($request.command -eq 'mute') {
            $value = [bool]$request.value
            [NxgsLiveAudio]::SetMute($value)
            $response = @{ id = $request.id; ok = $true; value = $value; message = $(if ($value) { 'System sound muted.' } else { 'System sound unmuted.' }) }
        } elseif ($request.command -eq 'brightness') {
            $value = [Math]::Max(0, [Math]::Min(100, [int]$request.value))
            $methods = @(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop)
            if ($methods.Count -eq 0) { throw 'Brightness control is not supported on this display.' }
            foreach ($method in $methods) {
                Invoke-CimMethod -InputObject $method -MethodName WmiSetBrightness -Arguments @{ Timeout = 0; Brightness = [byte]$value } -ErrorAction Stop | Out-Null
            }
            $response = @{ id = $request.id; ok = $true; value = $value; message = "Brightness changed to $value%." }
        } elseif ($request.command -eq 'escape') {
            $value = [long]$request.value
            $delivery = [NxgsWarningInput]::SendEscape($value)
            if ($delivery -ne 'ok') { throw "Could not deliver native Escape input ($delivery)." }
            $response = @{ id = $request.id; ok = $true; value = $value; message = 'Native Escape input delivered to the foreground game window.' }
        } elseif ($request.command -eq 'focus-window') {
            $handle = [long]$request.value
            $focused = [NxgsWarningInput]::FocusWindow($handle)
            $response = @{ id = $request.id; ok = $focused; value = $focused; message = $(if ($focused) { 'Game window focused.' } else { 'Game window focus was not confirmed.' }) }
        } elseif ($request.command -eq 'release-window') {
            $handle = [long]$request.value
            $released = [NxgsWarningInput]::ReleaseWindow($handle)
            $response = @{ id = $request.id; ok = $released; value = $released; message = $(if ($released) { 'Game window topmost state released.' } else { 'Game window could not be released.' }) }
        } elseif ($request.command -eq 'close-window') {
            $handle = [long]$request.value
            $closed = [NxgsWarningInput]::CloseWindow($handle)
            $response = @{ id = $request.id; ok = $closed; value = $closed; message = $(if ($closed) { 'Game close request posted.' } else { 'Game close request was not accepted.' }) }
        } else {
            throw "Unknown NXGS control command: $($request.command)"
        }
    } catch {
        $response = @{ id = $(if ($null -ne $request) { $request.id } else { 0 }); ok = $false; message = $_.Exception.Message }
    }
    [Console]::Out.WriteLine(($response | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
}
`;

let worker: ChildProcessWithoutNullStreams | null = null;
let stdoutBuffer = '';
let nextRequestId = 0;
const pending = new Map<number, PendingRequest>();

function rejectPending(message: string): void {
  for (const request of pending.values()) {
    clearTimeout(request.timeout);
    request.reject(new Error(message));
  }
  pending.clear();
}

function ensureWorker(): ChildProcessWithoutNullStreams {
  if (worker && !worker.killed && worker.exitCode === null) return worker;

  worker = spawn(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      '[ScriptBlock]::Create($env:NXGS_WINDOWS_CONTROL_WORKER).Invoke()'
    ],
    {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NXGS_WINDOWS_CONTROL_WORKER: WORKER_SCRIPT }
    }
  );
  stdoutBuffer = '';
  worker.stdout.setEncoding('utf8');
  worker.stderr.resume();
  worker.stdout.on('data', (chunk: string) => {
    stdoutBuffer += chunk;
    let newline = stdoutBuffer.indexOf('\n');
    while (newline >= 0) {
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (line) {
        try {
          const result = JSON.parse(line) as WindowsControlResult & { id: number };
          const request = pending.get(result.id);
          if (request) {
            pending.delete(result.id);
            clearTimeout(request.timeout);
            request.resolve({ ok: result.ok, value: result.value, message: result.message });
          }
        } catch {
          // Ignore non-JSON PowerShell diagnostics; the request timeout reports a useful failure.
        }
      }
      newline = stdoutBuffer.indexOf('\n');
    }
  });
  worker.once('error', (error) => {
    rejectPending(`Live control failed: ${error.message}`);
    worker = null;
  });
  worker.once('exit', () => {
    rejectPending('Live control stopped unexpectedly.');
    worker = null;
  });
  return worker;
}

export function warmWindowsControlWorker(): void {
  if (process.platform === 'win32') ensureWorker();
}

export function runWindowsControl(command: WindowsControlCommand, value: number | boolean): Promise<WindowsControlResult> {
  if (process.platform !== 'win32') {
    return Promise.resolve({ ok: false, message: 'System controls are unavailable on this device.' });
  }

  const activeWorker = ensureWorker();
  const id = ++nextRequestId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error('The system control did not respond in time.'));
    }, 7000);
    pending.set(id, { resolve, reject, timeout });
    activeWorker.stdin.write(`${JSON.stringify({ id, command, value })}\n`);
  });
}

export function stopWindowsControlWorker(): void {
  if (!worker) return;
  rejectPending('NXGS is closing.');
  worker.kill();
  worker = null;
}
