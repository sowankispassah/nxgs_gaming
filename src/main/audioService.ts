import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AudioActionResult, AudioDeviceSummary, AudioStatus } from '../shared/types';
import { runWindowsControl } from './windowsControlWorker';

const execFileAsync = promisify(execFile);
let cachedAudioStatus: AudioStatus | null = null;

const CORE_AUDIO_PREAMBLE = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public sealed class NxgsAudioDevice {
    public string Id { get; set; }
    public string Name { get; set; }
    public string Kind { get; set; }
    public bool IsDefault { get; set; }
    public int Volume { get; set; }
    public bool Muted { get; set; }
}

public sealed class NxgsAudioSnapshot {
    public int MasterVolume { get; set; }
    public bool Muted { get; set; }
    public int InputVolume { get; set; }
    public bool InputMuted { get; set; }
    public NxgsAudioDevice[] OutputDevices { get; set; }
    public NxgsAudioDevice[] InputDevices { get; set; }
}

public static class NxgsCoreAudio {
    private enum EDataFlow { Render = 0, Capture = 1, All = 2 }
    private enum ERole { Console = 0, Multimedia = 1, Communications = 2 }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROPERTYKEY {
        public Guid FormatId;
        public uint PropertyId;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct PROPVARIANT {
        [FieldOffset(0)] public ushort VariantType;
        [FieldOffset(8)] public IntPtr PointerValue;
    }

    [ComImport]
    [Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class MMDeviceEnumeratorComObject { }

    [ComImport]
    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator {
        [PreserveSig] int EnumAudioEndpoints(EDataFlow dataFlow, uint stateMask, out IMMDeviceCollection devices);
        [PreserveSig] int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice device);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr callback);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr callback);
    }

    [ComImport]
    [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceCollection {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int Item(uint index, out IMMDevice device);
    }

    [ComImport]
    [Guid("D666063F-1587-4E43-81F1-B948E807363F")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice {
        [PreserveSig] int Activate(ref Guid iid, uint context, IntPtr activationParameters, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
        [PreserveSig] int OpenPropertyStore(uint access, out IPropertyStore properties);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out uint state);
    }

    [ComImport]
    [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int GetAt(uint index, out PROPERTYKEY key);
        [PreserveSig] int GetValue(ref PROPERTYKEY key, out PROPVARIANT value);
        [PreserveSig] int SetValue(ref PROPERTYKEY key, ref PROPVARIANT value);
        [PreserveSig] int Commit();
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

    [DllImport("ole32.dll")]
    private static extern int PropVariantClear(ref PROPVARIANT value);

    private const uint ActiveDevice = 0x00000001;
    private const uint ClsCtxAll = 23;
    private static readonly Guid EndpointVolumeId = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
    private static readonly PROPERTYKEY FriendlyNameKey = new PROPERTYKEY {
        FormatId = new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0"),
        PropertyId = 14
    };

    private static void Ensure(int result, string operation) {
        if (result != 0) Marshal.ThrowExceptionForHR(result, new IntPtr(-1));
    }

    private static string DeviceId(IMMDevice device) {
        string id;
        Ensure(device.GetId(out id), "read audio device id");
        return id;
    }

    private static string DeviceName(IMMDevice device) {
        IPropertyStore properties;
        Ensure(device.OpenPropertyStore(0, out properties), "open audio properties");
        try {
            var key = FriendlyNameKey;
            PROPVARIANT value;
            Ensure(properties.GetValue(ref key, out value), "read audio device name");
            try {
                if (value.VariantType == 31 && value.PointerValue != IntPtr.Zero) {
                    return Marshal.PtrToStringUni(value.PointerValue) ?? "Audio device";
                }
                return "Audio device";
            } finally {
                PropVariantClear(ref value);
            }
        } finally {
            Marshal.ReleaseComObject(properties);
        }
    }

    private static IAudioEndpointVolume EndpointVolume(IMMDevice device) {
        object instance;
        var iid = EndpointVolumeId;
        Ensure(device.Activate(ref iid, ClsCtxAll, IntPtr.Zero, out instance), "activate endpoint volume");
        return (IAudioEndpointVolume)instance;
    }

    private static void ReadVolume(IMMDevice device, out int volume, out bool muted) {
        var endpoint = EndpointVolume(device);
        try {
            float scalar;
            Ensure(endpoint.GetMasterVolumeLevelScalar(out scalar), "read endpoint volume");
            Ensure(endpoint.GetMute(out muted), "read endpoint mute");
            volume = Math.Max(0, Math.Min(100, (int)Math.Round(scalar * 100)));
        } finally {
            Marshal.ReleaseComObject(endpoint);
        }
    }

    private static string DefaultId(IMMDeviceEnumerator enumerator, EDataFlow flow) {
        IMMDevice device;
        if (enumerator.GetDefaultAudioEndpoint(flow, ERole.Multimedia, out device) != 0 || device == null) return null;
        try { return DeviceId(device); }
        finally { Marshal.ReleaseComObject(device); }
    }

    private static NxgsAudioDevice[] Enumerate(IMMDeviceEnumerator enumerator, EDataFlow flow, string kind, string defaultId) {
        IMMDeviceCollection collection;
        Ensure(enumerator.EnumAudioEndpoints(flow, ActiveDevice, out collection), "enumerate audio endpoints");
        try {
            uint count;
            Ensure(collection.GetCount(out count), "count audio endpoints");
            var result = new List<NxgsAudioDevice>();
            for (uint index = 0; index < count; index++) {
                IMMDevice device;
                if (collection.Item(index, out device) != 0 || device == null) continue;
                try {
                    int volume = 0;
                    bool muted = false;
                    try { ReadVolume(device, out volume, out muted); } catch { }
                    string id = DeviceId(device);
                    result.Add(new NxgsAudioDevice {
                        Id = id,
                        Name = DeviceName(device),
                        Kind = kind,
                        IsDefault = String.Equals(id, defaultId, StringComparison.OrdinalIgnoreCase),
                        Volume = volume,
                        Muted = muted
                    });
                } finally {
                    Marshal.ReleaseComObject(device);
                }
            }
            return result.ToArray();
        } finally {
            Marshal.ReleaseComObject(collection);
        }
    }

    public static NxgsAudioSnapshot Snapshot() {
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        try {
            string outputId = DefaultId(enumerator, EDataFlow.Render);
            string inputId = DefaultId(enumerator, EDataFlow.Capture);
            var outputs = Enumerate(enumerator, EDataFlow.Render, "output", outputId);
            var inputs = Enumerate(enumerator, EDataFlow.Capture, "input", inputId);
            var currentOutput = Array.Find(outputs, item => item.IsDefault);
            var currentInput = Array.Find(inputs, item => item.IsDefault);
            return new NxgsAudioSnapshot {
                MasterVolume = currentOutput == null ? 0 : currentOutput.Volume,
                Muted = currentOutput != null && currentOutput.Muted,
                InputVolume = currentInput == null ? 0 : currentInput.Volume,
                InputMuted = currentInput != null && currentInput.Muted,
                OutputDevices = outputs,
                InputDevices = inputs
            };
        } finally {
            Marshal.ReleaseComObject(enumerator);
        }
    }

    private static IMMDevice DefaultDevice(IMMDeviceEnumerator enumerator, EDataFlow flow) {
        IMMDevice device;
        Ensure(enumerator.GetDefaultAudioEndpoint(flow, ERole.Multimedia, out device), "get default audio endpoint");
        return device;
    }

    public static void SetOutputVolume(int volume) {
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        try {
            var device = DefaultDevice(enumerator, EDataFlow.Render);
            try {
                var endpoint = EndpointVolume(device);
                try {
                    var eventContext = Guid.Empty;
                    Ensure(endpoint.SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, volume)) / 100f, ref eventContext), "set master volume");
                } finally { Marshal.ReleaseComObject(endpoint); }
            } finally { Marshal.ReleaseComObject(device); }
        } finally { Marshal.ReleaseComObject(enumerator); }
    }

    public static void SetOutputMute(bool muted) {
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        try {
            var device = DefaultDevice(enumerator, EDataFlow.Render);
            try {
                var endpoint = EndpointVolume(device);
                try {
                    var eventContext = Guid.Empty;
                    Ensure(endpoint.SetMute(muted, ref eventContext), "set master mute");
                } finally { Marshal.ReleaseComObject(endpoint); }
            } finally { Marshal.ReleaseComObject(device); }
        } finally { Marshal.ReleaseComObject(enumerator); }
    }
}
'@
`;

const GET_AUDIO_SCRIPT = `${CORE_AUDIO_PREAMBLE}
[NxgsCoreAudio]::Snapshot() | ConvertTo-Json -Depth 6 -Compress
`;

const SET_VOLUME_SCRIPT = `${CORE_AUDIO_PREAMBLE}
$volume = 0
[void][int]::TryParse($env:NXGS_AUDIO_VOLUME, [ref]$volume)
[NxgsCoreAudio]::SetOutputVolume($volume)
[NxgsCoreAudio]::Snapshot() | ConvertTo-Json -Depth 6 -Compress
`;

const SET_MUTE_SCRIPT = `${CORE_AUDIO_PREAMBLE}
[NxgsCoreAudio]::SetOutputMute($env:NXGS_AUDIO_MUTED -eq 'true')
[NxgsCoreAudio]::Snapshot() | ConvertTo-Json -Depth 6 -Compress
`;

interface RawAudioDevice {
  Id?: unknown;
  Name?: unknown;
  Kind?: unknown;
  IsDefault?: unknown;
  Volume?: unknown;
  Muted?: unknown;
}

interface RawAudioSnapshot {
  MasterVolume?: unknown;
  Muted?: unknown;
  InputVolume?: unknown;
  InputMuted?: unknown;
  OutputDevices?: RawAudioDevice | RawAudioDevice[];
  InputDevices?: RawAudioDevice | RawAudioDevice[];
}

async function runPowerShell<T>(script: string, environment: Record<string, string> = {}): Promise<T> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      {
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, ...environment }
      }
    );
    const output = stdout.trim();
    if (!output) throw new Error('Windows returned no audio information.');
    return JSON.parse(output) as T;
  } catch (error) {
    const failure = error as { code?: string | number; killed?: boolean; signal?: string };
    if (failure.killed || failure.signal || failure.code === 'ETIMEDOUT') throw new Error('Windows audio did not respond in time.');
    throw new Error(`Windows audio command failed${failure.code ? ` (${failure.code})` : ''}.`);
  }
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 'true';
}

function asVolume(value: unknown): number {
  const volume = Number(value);
  return Number.isFinite(volume) ? Math.max(0, Math.min(100, Math.round(volume))) : 0;
}

function normalizeDevices(value: RawAudioDevice | RawAudioDevice[] | undefined, kind: 'output' | 'input'): AudioDeviceSummary[] {
  const devices = !value ? [] : Array.isArray(value) ? value : [value];
  return devices
    .filter((device) => typeof device.Id === 'string' && device.Id.length > 0)
    .map((device) => ({
      id: String(device.Id),
      name: typeof device.Name === 'string' && device.Name.trim() ? device.Name.trim() : kind === 'output' ? 'Audio output' : 'Microphone',
      kind,
      isDefault: asBoolean(device.IsDefault),
      volume: asVolume(device.Volume),
      muted: asBoolean(device.Muted)
    }))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
}

function normalizeStatus(raw: RawAudioSnapshot): AudioStatus {
  const outputDevices = normalizeDevices(raw.OutputDevices, 'output');
  const inputDevices = normalizeDevices(raw.InputDevices, 'input');
  const currentOutput = outputDevices.find((device) => device.isDefault);
  const currentInput = inputDevices.find((device) => device.isDefault);
  return {
    supported: true,
    masterVolume: asVolume(raw.MasterVolume),
    muted: asBoolean(raw.Muted),
    inputVolume: asVolume(raw.InputVolume),
    inputMuted: asBoolean(raw.InputMuted),
    outputDevices,
    inputDevices,
    currentOutputId: currentOutput?.id,
    currentOutputName: currentOutput?.name,
    currentInputId: currentInput?.id,
    currentInputName: currentInput?.name,
    deviceSwitchingSupported: false
  };
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/access.+denied/i.test(message)) return 'Windows denied access to system audio controls.';
  return message || 'Windows audio operation failed.';
}

export async function getAudioStatus(): Promise<AudioStatus> {
  if (process.platform !== 'win32') {
    return {
      supported: false,
      masterVolume: 0,
      muted: false,
      inputVolume: 0,
      inputMuted: false,
      outputDevices: [],
      inputDevices: [],
      deviceSwitchingSupported: false,
      message: 'System sound controls are available on Windows.'
    };
  }
  try {
    cachedAudioStatus = normalizeStatus(await runPowerShell<RawAudioSnapshot>(GET_AUDIO_SCRIPT));
    return cachedAudioStatus;
  } catch (error) {
    return {
      supported: false,
      masterVolume: 0,
      muted: false,
      inputVolume: 0,
      inputMuted: false,
      outputDevices: [],
      inputDevices: [],
      deviceSwitchingSupported: false,
      message: safeError(error)
    };
  }
}

export async function setMasterVolume(volume: number): Promise<AudioActionResult> {
  const normalized = asVolume(volume);
  if (process.platform !== 'win32') return { ok: false, message: 'System volume control is available on Windows.', audio: await getAudioStatus() };
  try {
    const result = await runWindowsControl('volume', normalized);
    if (!result.ok) throw new Error(result.message);
    const current = cachedAudioStatus ?? await getAudioStatus();
    cachedAudioStatus = {
      ...current,
      supported: true,
      masterVolume: normalized,
      outputDevices: current.outputDevices.map((device) => device.isDefault ? { ...device, volume: normalized } : device)
    };
    return { ok: true, message: `Volume set to ${normalized}%`, audio: cachedAudioStatus };
  } catch (error) {
    try {
      cachedAudioStatus = normalizeStatus(await runPowerShell<RawAudioSnapshot>(SET_VOLUME_SCRIPT, { NXGS_AUDIO_VOLUME: String(normalized) }));
      return { ok: true, message: `Volume set to ${cachedAudioStatus.masterVolume}%`, audio: cachedAudioStatus };
    } catch {
      return { ok: false, message: safeError(error), audio: await getAudioStatus() };
    }
  }
}

export async function setMasterMuted(muted: boolean): Promise<AudioActionResult> {
  if (process.platform !== 'win32') return { ok: false, message: 'System mute control is available on Windows.', audio: await getAudioStatus() };
  try {
    const result = await runWindowsControl('mute', muted);
    if (!result.ok) throw new Error(result.message);
    const current = cachedAudioStatus ?? await getAudioStatus();
    cachedAudioStatus = {
      ...current,
      supported: true,
      muted,
      outputDevices: current.outputDevices.map((device) => device.isDefault ? { ...device, muted } : device)
    };
    return { ok: true, message: muted ? 'System sound muted' : `Sound restored at ${cachedAudioStatus.masterVolume}%`, audio: cachedAudioStatus };
  } catch (error) {
    try {
      cachedAudioStatus = normalizeStatus(await runPowerShell<RawAudioSnapshot>(SET_MUTE_SCRIPT, { NXGS_AUDIO_MUTED: muted ? 'true' : 'false' }));
      return { ok: true, message: cachedAudioStatus.muted ? 'System sound muted' : `Sound restored at ${cachedAudioStatus.masterVolume}%`, audio: cachedAudioStatus };
    } catch {
      return { ok: false, message: safeError(error), audio: await getAudioStatus() };
    }
  }
}

export async function switchAudioDevice(deviceId: string, kind: 'output' | 'input'): Promise<AudioActionResult> {
  const audio = await getAudioStatus();
  const devices = kind === 'output' ? audio.outputDevices : audio.inputDevices;
  if (!devices.some((device) => device.id === deviceId)) {
    return { ok: false, message: 'Audio device not found. Refresh the list and try again.', audio };
  }
  return {
    ok: false,
    message: `Windows does not provide a supported desktop API for changing the default ${kind} device. NXGS kept the current device and did not open Windows Settings.`,
    audio
  };
}
