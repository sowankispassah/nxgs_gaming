import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export type WindowsControlCommand = 'volume' | 'mute' | 'brightness';

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

  const encoded = Buffer.from(WORKER_SCRIPT, 'utf16le').toString('base64');
  worker = spawn(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
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
    rejectPending(`Windows live control failed: ${error.message}`);
    worker = null;
  });
  worker.once('exit', () => {
    rejectPending('Windows live control stopped unexpectedly.');
    worker = null;
  });
  return worker;
}

export function warmWindowsControlWorker(): void {
  if (process.platform === 'win32') ensureWorker();
}

export function runWindowsControl(command: WindowsControlCommand, value: number | boolean): Promise<WindowsControlResult> {
  if (process.platform !== 'win32') {
    return Promise.resolve({ ok: false, message: 'Windows system controls are only available on Windows.' });
  }

  const activeWorker = ensureWorker();
  const id = ++nextRequestId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Windows did not respond to the live control in time.'));
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
