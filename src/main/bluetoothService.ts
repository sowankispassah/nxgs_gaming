import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  BluetoothActionResult,
  BluetoothDeviceSummary,
  BluetoothRadioState,
  BluetoothStatus
} from '../shared/types';

const execFileAsync = promisify(execFile);

const NATIVE_BLUETOOTH_PREAMBLE = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Globalization;
using System.Runtime.InteropServices;

public sealed class NxgsBluetoothDevice {
    public string Id { get; set; }
    public string Name { get; set; }
    public string Address { get; set; }
    public bool Paired { get; set; }
    public bool Connected { get; set; }
    public bool Connectable { get; set; }
}

public sealed class NxgsBluetoothAction {
    public bool Found { get; set; }
    public bool Success { get; set; }
    public int Code { get; set; }
}

public static class NxgsBluetoothNative {
    [StructLayout(LayoutKind.Explicit)]
    private struct BLUETOOTH_ADDRESS {
        [FieldOffset(0)] public ulong Value;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SYSTEMTIME {
        public ushort Year, Month, DayOfWeek, Day, Hour, Minute, Second, Milliseconds;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct BLUETOOTH_DEVICE_INFO {
        public int Size;
        public BLUETOOTH_ADDRESS Address;
        public uint ClassOfDevice;
        [MarshalAs(UnmanagedType.Bool)] public bool Connected;
        [MarshalAs(UnmanagedType.Bool)] public bool Remembered;
        [MarshalAs(UnmanagedType.Bool)] public bool Authenticated;
        public SYSTEMTIME LastSeen;
        public SYSTEMTIME LastUsed;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 248)] public string Name;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BLUETOOTH_DEVICE_SEARCH_PARAMS {
        public int Size;
        [MarshalAs(UnmanagedType.Bool)] public bool ReturnAuthenticated;
        [MarshalAs(UnmanagedType.Bool)] public bool ReturnRemembered;
        [MarshalAs(UnmanagedType.Bool)] public bool ReturnUnknown;
        [MarshalAs(UnmanagedType.Bool)] public bool ReturnConnected;
        [MarshalAs(UnmanagedType.Bool)] public bool IssueInquiry;
        public byte TimeoutMultiplier;
        public IntPtr Radio;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BLUETOOTH_FIND_RADIO_PARAMS { public int Size; }

    [DllImport("bthprops.cpl", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr BluetoothFindFirstDevice(ref BLUETOOTH_DEVICE_SEARCH_PARAMS search, ref BLUETOOTH_DEVICE_INFO info);

    [DllImport("bthprops.cpl", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool BluetoothFindNextDevice(IntPtr find, ref BLUETOOTH_DEVICE_INFO info);

    [DllImport("bthprops.cpl", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool BluetoothFindDeviceClose(IntPtr find);

    [DllImport("bthprops.cpl", SetLastError = true)]
    private static extern IntPtr BluetoothFindFirstRadio(ref BLUETOOTH_FIND_RADIO_PARAMS search, out IntPtr radio);

    [DllImport("bthprops.cpl", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool BluetoothFindRadioClose(IntPtr find);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("bthprops.cpl", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int BluetoothAuthenticateDeviceEx(IntPtr parentWindow, IntPtr radio, ref BLUETOOTH_DEVICE_INFO info, IntPtr oobData, int requirements);

    [DllImport("bthprops.cpl", SetLastError = true)]
    private static extern int BluetoothRemoveDevice(ref BLUETOOTH_ADDRESS address);

    private static NxgsBluetoothDevice Convert(BLUETOOTH_DEVICE_INFO info) {
        string address = info.Address.Value.ToString("X12", CultureInfo.InvariantCulture);
        return new NxgsBluetoothDevice {
            Id = address,
            Name = String.IsNullOrWhiteSpace(info.Name) ? "Bluetooth device" : info.Name.Trim(),
            Address = String.Join(":", new[] { address.Substring(0,2), address.Substring(2,2), address.Substring(4,2), address.Substring(6,2), address.Substring(8,2), address.Substring(10,2) }),
            Paired = info.Authenticated || info.Remembered,
            Connected = info.Connected,
            Connectable = true
        };
    }

    private static List<BLUETOOTH_DEVICE_INFO> Find(byte timeoutMultiplier, bool inquiry) {
        var records = new List<BLUETOOTH_DEVICE_INFO>();
        var search = new BLUETOOTH_DEVICE_SEARCH_PARAMS {
            Size = Marshal.SizeOf(typeof(BLUETOOTH_DEVICE_SEARCH_PARAMS)),
            ReturnAuthenticated = true,
            ReturnRemembered = true,
            ReturnUnknown = true,
            ReturnConnected = true,
            IssueInquiry = inquiry,
            TimeoutMultiplier = timeoutMultiplier,
            Radio = IntPtr.Zero
        };
        var info = new BLUETOOTH_DEVICE_INFO { Size = Marshal.SizeOf(typeof(BLUETOOTH_DEVICE_INFO)) };
        IntPtr find = BluetoothFindFirstDevice(ref search, ref info);
        if (find == IntPtr.Zero) return records;
        try {
            do {
                records.Add(info);
                info = new BLUETOOTH_DEVICE_INFO { Size = Marshal.SizeOf(typeof(BLUETOOTH_DEVICE_INFO)) };
            } while (BluetoothFindNextDevice(find, ref info));
        } finally {
            BluetoothFindDeviceClose(find);
        }
        return records;
    }

    private static bool TryAddress(string value, out BLUETOOTH_ADDRESS address) {
        address = new BLUETOOTH_ADDRESS();
        ulong parsed;
        if (String.IsNullOrWhiteSpace(value) || !UInt64.TryParse(value.Replace(":", ""), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out parsed)) return false;
        address.Value = parsed;
        return true;
    }

    public static bool HasRadio() {
        var search = new BLUETOOTH_FIND_RADIO_PARAMS { Size = Marshal.SizeOf(typeof(BLUETOOTH_FIND_RADIO_PARAMS)) };
        IntPtr radio;
        IntPtr find = BluetoothFindFirstRadio(ref search, out radio);
        if (find == IntPtr.Zero) return false;
        if (radio != IntPtr.Zero) CloseHandle(radio);
        BluetoothFindRadioClose(find);
        return true;
    }

    public static NxgsBluetoothDevice[] Scan() {
        var devices = new List<NxgsBluetoothDevice>();
        foreach (var info in Find(5, true)) devices.Add(Convert(info));
        return devices.ToArray();
    }

    public static NxgsBluetoothAction Pair(string id, long ownerWindow) {
        BLUETOOTH_ADDRESS address;
        if (!TryAddress(id, out address)) return new NxgsBluetoothAction { Found = false, Success = false, Code = 1168 };
        foreach (var infoValue in Find(1, true)) {
            if (infoValue.Address.Value != address.Value) continue;
            var info = infoValue;
            if (info.Authenticated || info.Remembered) return new NxgsBluetoothAction { Found = true, Success = true, Code = 0 };
            int code = BluetoothAuthenticateDeviceEx(new IntPtr(ownerWindow), IntPtr.Zero, ref info, IntPtr.Zero, 0);
            return new NxgsBluetoothAction { Found = true, Success = code == 0, Code = code };
        }
        return new NxgsBluetoothAction { Found = false, Success = false, Code = 1168 };
    }

    public static NxgsBluetoothAction Unpair(string id) {
        BLUETOOTH_ADDRESS address;
        if (!TryAddress(id, out address)) return new NxgsBluetoothAction { Found = false, Success = false, Code = 1168 };
        int code = BluetoothRemoveDevice(ref address);
        return new NxgsBluetoothAction { Found = code != 1168, Success = code == 0, Code = code };
    }
}
'@
`;

const SCAN_SCRIPT = `${NATIVE_BLUETOOTH_PREAMBLE}
$hasRadio = [NxgsBluetoothNative]::HasRadio()
$devices = if ($hasRadio) { @([NxgsBluetoothNative]::Scan()) } else { @() }
[pscustomobject]@{ radioState = if ($hasRadio) { 'on' } else { 'off' }; devices = $devices } | ConvertTo-Json -Depth 5 -Compress
`;

const PAIR_SCRIPT = `${NATIVE_BLUETOOTH_PREAMBLE}
$owner = 0L
[void][long]::TryParse($env:NXGS_BLUETOOTH_OWNER, [ref]$owner)
$result = [NxgsBluetoothNative]::Pair($env:NXGS_BLUETOOTH_DEVICE_ID, $owner)
[pscustomobject]@{ found = $result.Found; success = $result.Success; status = [string]$result.Code } | ConvertTo-Json -Compress
`;

const DISCONNECT_SCRIPT = `${NATIVE_BLUETOOTH_PREAMBLE}
$result = [NxgsBluetoothNative]::Unpair($env:NXGS_BLUETOOTH_DEVICE_ID)
[pscustomobject]@{ found = $result.Found; success = $result.Success; status = [string]$result.Code } | ConvertTo-Json -Compress
`;

interface RawBluetoothDevice {
  Id?: unknown;
  Name?: unknown;
  Address?: unknown;
  Paired?: unknown;
  Connected?: unknown;
  Connectable?: unknown;
}

interface RawBluetoothScan {
  radioState?: unknown;
  devices?: RawBluetoothDevice | RawBluetoothDevice[];
}

interface RawBluetoothAction {
  found?: unknown;
  success?: unknown;
  status?: unknown;
}

async function runPowerShell<T>(script: string, environment: Record<string, string> = {}): Promise<T> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      {
        windowsHide: true,
        timeout: 20000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, ...environment }
      }
    );
    const output = stdout.trim();
    if (!output) throw new Error('Windows returned no Bluetooth information.');
    return JSON.parse(output) as T;
  } catch (error) {
    const failure = error as { stderr?: string | Buffer; code?: string | number; killed?: boolean; signal?: string };
    if (failure.killed || failure.signal || failure.code === 'ETIMEDOUT') throw new Error('Bluetooth scan timed out.');
    throw new Error(`Windows Bluetooth command failed${failure.code ? ` (${failure.code})` : ''}.`);
  }
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 'true';
}

function asRadioState(value: unknown): BluetoothRadioState {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized === 'on' || normalized === 'off' || normalized === 'disabled') return normalized;
  return 'unknown';
}

function normalizeDevices(value: RawBluetoothScan['devices']): BluetoothDeviceSummary[] {
  const devices = !value ? [] : Array.isArray(value) ? value : [value];
  return devices
    .filter((device) => typeof device.Id === 'string' && device.Id.length > 0)
    .map((device) => ({
      id: String(device.Id),
      name: typeof device.Name === 'string' && device.Name.trim() ? device.Name.trim() : 'Bluetooth device',
      address: typeof device.Address === 'string' && device.Address ? device.Address : undefined,
      paired: asBoolean(device.Paired),
      connected: asBoolean(device.Connected),
      connectable: asBoolean(device.Connectable)
    }))
    .filter((device, index, all) => all.findIndex((item) => item.id === device.id) === index)
    .sort((a, b) => Number(b.connected) - Number(a.connected) || Number(b.paired) - Number(a.paired) || a.name.localeCompare(b.name));
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/access is denied|access denied|denied by system/i.test(message)) {
    return 'Windows denied Bluetooth access. Check that Bluetooth is enabled and NXGS has permission to manage devices.';
  }
  if (/timeout/i.test(message)) return 'Bluetooth did not respond before the scan timed out.';
  return message || 'Bluetooth operation failed.';
}

function windowsPairingError(code: string): string {
  if (code === '1223') return 'Pairing was cancelled.';
  if (code === '1460') return 'Pairing timed out. Keep the device in pairing mode and try again.';
  if (code === '1244' || code === '86') return 'Windows rejected the device authentication.';
  if (code === '5') return 'Windows denied permission to pair this device.';
  return `Pairing failed (Windows error ${code}). Keep the device in pairing mode and try again.`;
}

export async function scanBluetoothDevices(): Promise<BluetoothStatus> {
  if (process.platform !== 'win32') {
    return { supported: false, radioState: 'unsupported', devices: [], message: 'Bluetooth management is available on Windows.' };
  }
  try {
    const result = await runPowerShell<RawBluetoothScan>(SCAN_SCRIPT);
    const radioState = asRadioState(result.radioState);
    return {
      supported: true,
      radioState,
      devices: normalizeDevices(result.devices),
      message: radioState === 'off'
        ? 'Bluetooth is off or no radio is available. Enable the device hardware control, then scan again.'
        : undefined
    };
  } catch (error) {
    return { supported: false, radioState: 'unknown', devices: [], message: safeError(error) };
  }
}

export async function pairBluetoothDevice(deviceId: string, ownerWindow = '0'): Promise<BluetoothActionResult> {
  if (!/^[0-9a-f]{12}$/i.test(deviceId)) {
    const bluetooth = await scanBluetoothDevices();
    return { ok: false, status: 'device-not-found', message: 'Device not found. Scan again and retry.', bluetooth };
  }
  try {
    const result = await runPowerShell<RawBluetoothAction>(PAIR_SCRIPT, {
      NXGS_BLUETOOTH_DEVICE_ID: deviceId,
      NXGS_BLUETOOTH_OWNER: ownerWindow
    });
    const bluetooth = await scanBluetoothDevices();
    if (!asBoolean(result.found)) {
      return { ok: false, status: 'device-not-found', message: 'Device not found. Put it in pairing mode and scan again.', bluetooth };
    }
    if (!asBoolean(result.success)) {
      return { ok: false, status: 'failed', message: windowsPairingError(String(result.status ?? 'unknown')), bluetooth };
    }
    if (bluetooth.devices.some((device) => device.id === deviceId && device.connected)) {
      return { ok: true, status: 'connected', message: 'Connected', bluetooth };
    }
    return {
      ok: true,
      status: 'paired',
      message: 'Paired. Wake the controller or press its Home button while Windows finishes connecting it.',
      bluetooth
    };
  } catch (error) {
    const bluetooth = await scanBluetoothDevices();
    return { ok: false, status: 'failed', message: safeError(error), bluetooth };
  }
}

export async function disconnectBluetoothDevice(deviceId: string): Promise<BluetoothActionResult> {
  if (!/^[0-9a-f]{12}$/i.test(deviceId)) {
    const bluetooth = await scanBluetoothDevices();
    return { ok: false, status: 'device-not-found', message: 'Device not found. Scan again and retry.', bluetooth };
  }
  try {
    const result = await runPowerShell<RawBluetoothAction>(DISCONNECT_SCRIPT, { NXGS_BLUETOOTH_DEVICE_ID: deviceId });
    const bluetooth = await scanBluetoothDevices();
    if (!asBoolean(result.found)) {
      return { ok: false, status: 'device-not-found', message: 'Device not found. Scan again and retry.', bluetooth };
    }
    if (!asBoolean(result.success)) {
      return { ok: false, status: 'failed', message: `Windows could not disconnect this device (error ${String(result.status ?? 'unknown')}).`, bluetooth };
    }
    return {
      ok: true,
      status: 'disconnected',
      message: 'Disconnected. Windows pairing was removed; scan and pair the device again to reconnect.',
      bluetooth
    };
  } catch (error) {
    const bluetooth = await scanBluetoothDevices();
    return { ok: false, status: 'failed', message: safeError(error), bluetooth };
  }
}
