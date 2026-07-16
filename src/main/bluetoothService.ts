import { spawn } from 'node:child_process';
import type {
  BluetoothActionResult,
  BluetoothDeviceSummary,
  BluetoothRadioState,
  BluetoothStatus
} from '../shared/types';
import { logLine } from './logger';

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
    public bool Controller { get; set; }
    public bool InputReady { get; set; }
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
    private static extern bool BluetoothFindNextRadio(IntPtr find, out IntPtr radio);

    [DllImport("bthprops.cpl", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool BluetoothFindRadioClose(IntPtr find);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DeviceIoControl(IntPtr device, uint controlCode, ref BLUETOOTH_ADDRESS input, int inputSize, IntPtr output, int outputSize, out int bytesReturned, IntPtr overlapped);

    [DllImport("bthprops.cpl", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int BluetoothAuthenticateDeviceEx(IntPtr parentWindow, IntPtr radio, ref BLUETOOTH_DEVICE_INFO info, IntPtr oobData, int requirements);

    [DllImport("bthprops.cpl", SetLastError = true)]
    private static extern int BluetoothSetServiceState(IntPtr radio, ref BLUETOOTH_DEVICE_INFO info, ref Guid service, uint flags);

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
            Connectable = true,
            Controller = info.Name != null && (
                info.Name.IndexOf("controller", StringComparison.OrdinalIgnoreCase) >= 0 ||
                info.Name.IndexOf("gamepad", StringComparison.OrdinalIgnoreCase) >= 0 ||
                info.Name.IndexOf("dualsense", StringComparison.OrdinalIgnoreCase) >= 0 ||
                info.Name.IndexOf("dualshock", StringComparison.OrdinalIgnoreCase) >= 0
            ),
            InputReady = false
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

    public static NxgsBluetoothDevice[] Scan(bool inquiry) {
        var devices = new List<NxgsBluetoothDevice>();
        foreach (var info in Find(inquiry ? (byte)5 : (byte)1, inquiry)) devices.Add(Convert(info));
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

    public static NxgsBluetoothAction RequestHidConnection(string id) {
        BLUETOOTH_ADDRESS address;
        if (!TryAddress(id, out address)) return new NxgsBluetoothAction { Found = false, Success = false, Code = 1168 };
        BLUETOOTH_DEVICE_INFO selected = new BLUETOOTH_DEVICE_INFO();
        bool found = false;
        foreach (var info in Find(1, false)) {
            if (info.Address.Value != address.Value) continue;
            selected = info;
            found = true;
            break;
        }
        if (!found) return new NxgsBluetoothAction { Found = false, Success = false, Code = 1168 };
        if (selected.Connected) return new NxgsBluetoothAction { Found = true, Success = true, Code = 0 };

        var search = new BLUETOOTH_FIND_RADIO_PARAMS { Size = Marshal.SizeOf(typeof(BLUETOOTH_FIND_RADIO_PARAMS)) };
        IntPtr radio;
        IntPtr radioFind = BluetoothFindFirstRadio(ref search, out radio);
        if (radioFind == IntPtr.Zero) return new NxgsBluetoothAction { Found = true, Success = false, Code = Marshal.GetLastWin32Error() };
        var hidService = new Guid("00001124-0000-1000-8000-00805F9B34FB");
        int lastError = 1;
        try {
            do {
                try {
                    int code = BluetoothSetServiceState(radio, ref selected, ref hidService, 1);
                    lastError = code;
                    if (code == 0 || code == unchecked((int)0x80070057)) {
                        return new NxgsBluetoothAction { Found = true, Success = true, Code = code };
                    }
                } finally {
                    if (radio != IntPtr.Zero) CloseHandle(radio);
                }
            } while (BluetoothFindNextRadio(radioFind, out radio));
        } finally {
            BluetoothFindRadioClose(radioFind);
        }
        return new NxgsBluetoothAction { Found = true, Success = false, Code = lastError };
    }

    public static NxgsBluetoothAction Disconnect(string id) {
        BLUETOOTH_ADDRESS address;
        if (!TryAddress(id, out address)) return new NxgsBluetoothAction { Found = false, Success = false, Code = 1168 };
        bool found = false;
        bool connected = false;
        foreach (var info in Find(1, false)) {
            if (info.Address.Value != address.Value) continue;
            found = true;
            connected = info.Connected;
            break;
        }
        if (!found) return new NxgsBluetoothAction { Found = false, Success = false, Code = 1168 };
        if (!connected) return new NxgsBluetoothAction { Found = true, Success = true, Code = 1167 };

        var search = new BLUETOOTH_FIND_RADIO_PARAMS { Size = Marshal.SizeOf(typeof(BLUETOOTH_FIND_RADIO_PARAMS)) };
        IntPtr radio;
        IntPtr find = BluetoothFindFirstRadio(ref search, out radio);
        if (find == IntPtr.Zero) return new NxgsBluetoothAction { Found = true, Success = false, Code = Marshal.GetLastWin32Error() };
        int lastError = 1;
        try {
            do {
                try {
                    int returned;
                    if (DeviceIoControl(radio, 0x0041000C, ref address, Marshal.SizeOf(typeof(BLUETOOTH_ADDRESS)), IntPtr.Zero, 0, out returned, IntPtr.Zero)) {
                        return new NxgsBluetoothAction { Found = true, Success = true, Code = 0 };
                    }
                    lastError = Marshal.GetLastWin32Error();
                    if (lastError == 1167) return new NxgsBluetoothAction { Found = true, Success = true, Code = lastError };
                } finally {
                    if (radio != IntPtr.Zero) CloseHandle(radio);
                }
            } while (BluetoothFindNextRadio(find, out radio));
        } finally {
            BluetoothFindRadioClose(find);
        }
        return new NxgsBluetoothAction { Found = true, Success = false, Code = lastError };
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
$issueInquiry = $env:NXGS_BLUETOOTH_INQUIRY -eq '1'
$devices = if ($hasRadio) { @([NxgsBluetoothNative]::Scan($issueInquiry)) } else { @() }
if ($hasRadio) {
    $pairedPnpDevices = @(Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue | Where-Object {
        $_.InstanceId -like 'BTHENUM\DEV_*' -and $_.InstanceId -match 'DEV_([0-9A-F]{12})' -and -not [string]::IsNullOrWhiteSpace($_.FriendlyName)
    })
    foreach ($pnpDevice in $pairedPnpDevices) {
        [void]($pnpDevice.InstanceId -match 'DEV_([0-9A-F]{12})')
        $id = $Matches[1].ToUpperInvariant()
        if (@($devices | Where-Object { $_.Id -eq $id }).Count -gt 0) { continue }
        $devices += [pscustomobject]@{
            Id = $id
            Name = [string]$pnpDevice.FriendlyName
            Address = ($id -replace '(..)(?!$)', '$1:')
            Paired = $true
            Connected = $false
            Connectable = $true
            Controller = [string]$pnpDevice.FriendlyName -match '(?i)controller|gamepad|dualsense|dualshock'
            InputReady = $false
        }
    }

    $presentHidContainers = @{}
    $presentHidControllers = @(Get-PnpDevice -PresentOnly -Class HIDClass -ErrorAction SilentlyContinue | Where-Object {
        $_.FriendlyName -eq 'HID-compliant game controller' -or
        $_.InstanceId -match '(?i)VID_054C|VID&0002054C|IG_'
    })
    foreach ($hidDevice in $presentHidControllers) {
        $container = Get-PnpDeviceProperty -InstanceId $hidDevice.InstanceId -KeyName 'DEVPKEY_Device_ContainerId' -ErrorAction SilentlyContinue
        if ($null -ne $container -and $null -ne $container.Data) {
            $presentHidContainers[[string]$container.Data] = $true
        }
    }

    foreach ($device in $devices) {
        $isController = [bool]$device.Controller -or [string]$device.Name -match '(?i)controller|gamepad|dualsense|dualshock'
        $inputReady = $false
        $pnpDevice = $pairedPnpDevices | Where-Object { $_.InstanceId -like "BTHENUM\DEV_$($device.Id)*" } | Select-Object -First 1
        if ($null -ne $pnpDevice) {
            $container = Get-PnpDeviceProperty -InstanceId $pnpDevice.InstanceId -KeyName 'DEVPKEY_Device_ContainerId' -ErrorAction SilentlyContinue
            if ($null -ne $container -and $null -ne $container.Data) {
                $inputReady = $presentHidContainers.ContainsKey([string]$container.Data)
            }
        }
        $device.Controller = $isController
        $device.InputReady = $inputReady
        $device.Connected = [bool]$device.Connected -or $inputReady
    }
}
[pscustomobject]@{ radioState = if ($hasRadio) { 'on' } else { 'off' }; devices = $devices } | ConvertTo-Json -Depth 5 -Compress
`;

const PAIR_SCRIPT = `${NATIVE_BLUETOOTH_PREAMBLE}
$owner = 0L
[void][long]::TryParse($env:NXGS_BLUETOOTH_OWNER, [ref]$owner)
$result = [NxgsBluetoothNative]::Pair($env:NXGS_BLUETOOTH_DEVICE_ID, $owner)
[pscustomobject]@{ found = $result.Found; success = $result.Success; status = [string]$result.Code } | ConvertTo-Json -Compress
`;

const CONNECT_CONTROLLER_SCRIPT = `${NATIVE_BLUETOOTH_PREAMBLE}
$result = [NxgsBluetoothNative]::RequestHidConnection($env:NXGS_BLUETOOTH_DEVICE_ID)
[pscustomobject]@{ found = $result.Found; success = $result.Success; status = [string]$result.Code } | ConvertTo-Json -Compress
`;

const DISCONNECT_SCRIPT = `${NATIVE_BLUETOOTH_PREAMBLE}
$result = [NxgsBluetoothNative]::Disconnect($env:NXGS_BLUETOOTH_DEVICE_ID)
[pscustomobject]@{ found = $result.Found; success = $result.Success; status = [string]$result.Code } | ConvertTo-Json -Compress
`;

const REMOVE_SCRIPT = `${NATIVE_BLUETOOTH_PREAMBLE}
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
  Controller?: unknown;
  InputReady?: unknown;
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
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        'powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
        {
          windowsHide: true,
          env: { ...process.env, ...environment },
          stdio: ['pipe', 'pipe', 'pipe']
        }
      );
      const output: Buffer[] = [];
      const errors: Buffer[] = [];
      let outputBytes = 0;
      let settled = false;
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback();
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(() => reject(new Error('Bluetooth scan timed out.')));
      }, 20000);

      child.stdout.on('data', (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > 4 * 1024 * 1024) {
          child.kill();
          finish(() => reject(new Error('Bluetooth returned too much information.')));
          return;
        }
        output.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => errors.push(chunk));
      child.on('error', (error) => finish(() => reject(error)));
      child.on('close', (code) => {
        finish(() => {
          const outputText = Buffer.concat(output).toString('utf8').trim();
          const errorText = Buffer.concat(errors).toString('utf8').trim();
          if (code !== 0) {
            reject(new Error(errorText || `Bluetooth PowerShell exited with ${code ?? 'unknown'}.`));
            return;
          }
          if (!outputText) {
            reject(new Error(errorText || 'No Bluetooth information was returned.'));
            return;
          }
          resolve(outputText);
        });
      });
      child.stdin.on('error', (error) => finish(() => reject(error)));
      child.stdin.end(`${script}\r\n`, 'utf8');
    });
    const output = stdout.trim();
    if (!output) throw new Error('No Bluetooth information was returned.');
    return JSON.parse(output) as T;
  } catch (error) {
    const failure = error as { code?: string | number; message?: string };
    await logLine(
      'error',
      `Bluetooth PowerShell action failed${failure.code ? ` (${failure.code})` : ''}: ${failure.message ?? String(error)}`
    );
    if (failure.code === 'ETIMEDOUT' || /timed out/i.test(failure.message ?? '')) {
      throw new Error('Bluetooth scan timed out.');
    }
    throw new Error(`Bluetooth action failed${failure.code ? ` (${failure.code})` : ''}.`);
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
      connectable: asBoolean(device.Connectable),
      controller: asBoolean(device.Controller),
      inputReady: asBoolean(device.InputReady)
    }))
    .filter((device, index, all) => all.findIndex((item) => item.id === device.id) === index)
    .sort((a, b) => Number(b.connected) - Number(a.connected) || Number(b.paired) - Number(a.paired) || a.name.localeCompare(b.name));
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/access is denied|access denied|denied by system/i.test(message)) {
    return 'Bluetooth access was denied. Check that Bluetooth is on and NXGS can manage devices.';
  }
  if (/timeout/i.test(message)) return 'Bluetooth did not respond before the scan timed out.';
  return message || 'Bluetooth operation failed.';
}

function windowsPairingError(code: string): string {
  if (code === '1223') return 'Pairing was cancelled.';
  if (code === '1460') return 'Pairing timed out. Keep the device in pairing mode and try again.';
  if (code === '1244' || code === '86') return 'Device authentication was rejected.';
  if (code === '5') return 'Permission to pair this device was denied.';
  return `Pairing failed (error ${code}). Keep the device in pairing mode and try again.`;
}

function windowsDisconnectError(code: string): string {
  if (code === '5') return 'Permission to disconnect this device was denied. The device remains paired.';
  if (code === '50' || code === '1') return 'This device profile cannot be disconnected here. Turn the device off, then scan again.';
  return `This device could not be disconnected (error ${code}). It remains paired.`;
}

function windowsRemoveError(code: string): string {
  if (code === '5') return 'Permission to remove this device was denied.';
  if (code === '1168') return 'Device not found. It may already have been removed.';
  return `This device could not be removed (error ${code}).`;
}

export async function scanBluetoothDevices(issueInquiry = true): Promise<BluetoothStatus> {
  if (process.platform !== 'win32') {
    return { supported: false, radioState: 'unsupported', devices: [], message: 'Bluetooth management is unavailable on this system.' };
  }
  try {
    const result = await runPowerShell<RawBluetoothScan>(SCAN_SCRIPT, {
      NXGS_BLUETOOTH_INQUIRY: issueInquiry ? '1' : '0'
    });
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

async function waitForControllerInput(
  deviceId: string,
  attempts = 8
): Promise<{ bluetooth: BluetoothStatus; device?: BluetoothDeviceSummary }> {
  let bluetooth = await scanBluetoothDevices(false);
  let device = bluetooth.devices.find((candidate) => candidate.id.toLowerCase() === deviceId.toLowerCase());
  for (let attempt = 1; attempt < attempts && bluetooth.supported && !device?.inputReady; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    bluetooth = await scanBluetoothDevices(false);
    device = bluetooth.devices.find((candidate) => candidate.id.toLowerCase() === deviceId.toLowerCase());
  }
  return { bluetooth, device };
}

async function requestControllerConnection(deviceId: string): Promise<RawBluetoothAction> {
  const result = await runPowerShell<RawBluetoothAction>(CONNECT_CONTROLLER_SCRIPT, {
    NXGS_BLUETOOTH_DEVICE_ID: deviceId
  });
  await logLine(
    asBoolean(result.success) ? 'info' : 'warn',
    `Controller connection request for ${deviceId} ${asBoolean(result.success) ? 'was accepted' : `failed with ${String(result.status ?? 'unknown')}`}.`
  );
  return result;
}

export async function pairBluetoothDevice(deviceId: string, ownerWindow = '0'): Promise<BluetoothActionResult> {
  if (!/^[0-9a-f]{12}$/i.test(deviceId)) {
    const bluetooth = await scanBluetoothDevices(false);
    return { ok: false, status: 'device-not-found', message: 'Device not found. Scan again and retry.', bluetooth };
  }
  try {
    const before = await scanBluetoothDevices(false);
    const existing = before.devices.find((device) => device.id.toLowerCase() === deviceId.toLowerCase());
    if (existing?.paired && existing.controller && existing.inputReady) {
      return {
        ok: true,
        status: 'connected',
        message: 'Controller input is already connected and ready.',
        bluetooth: before
      };
    }
    if (existing?.paired && existing.controller) {
      await logLine(
        'info',
        `Requesting the HID controller service for ${existing.name} (${existing.id}) without removing its saved pairing.`
      );
      const request = await requestControllerConnection(deviceId);
      if (!asBoolean(request.found)) {
        return { ok: false, status: 'device-not-found', message: 'Controller not found. Scan again and retry.', bluetooth: before };
      }
      const checked = await waitForControllerInput(deviceId);
      if (checked.device?.inputReady) {
        return {
          ok: true,
          status: 'connected',
          message: 'Controller input connected and ready.',
          bluetooth: checked.bluetooth
        };
      }
      return {
        ok: asBoolean(request.success),
        status: 'paired',
        message: asBoolean(request.success)
          ? 'Connection requested. Keep the controller awake and press PS / Home once; NXGS will detect it automatically.'
          : 'The controller stayed paired, but the connection request was not accepted. Press PS / Home once and NXGS will detect it automatically.',
        bluetooth: checked.bluetooth
      };
    }
    const result = await runPowerShell<RawBluetoothAction>(PAIR_SCRIPT, {
      NXGS_BLUETOOTH_DEVICE_ID: deviceId,
      NXGS_BLUETOOTH_OWNER: ownerWindow
    });
    if (!asBoolean(result.found)) {
      const bluetooth = await scanBluetoothDevices(false);
      return { ok: false, status: 'device-not-found', message: 'Device not found. Put it in pairing mode and scan again.', bluetooth };
    }
    if (!asBoolean(result.success)) {
      const bluetooth = await scanBluetoothDevices(false);
      return { ok: false, status: 'failed', message: windowsPairingError(String(result.status ?? 'unknown')), bluetooth };
    }
    let checked = await waitForControllerInput(deviceId);
    let bluetooth = checked.bluetooth;
    let connectedDevice = checked.device;
    if (connectedDevice?.controller && !connectedDevice.inputReady) {
      await requestControllerConnection(deviceId);
      checked = await waitForControllerInput(deviceId);
      bluetooth = checked.bluetooth;
      connectedDevice = checked.device;
    }
    if (connectedDevice?.controller && connectedDevice.inputReady) {
      return { ok: true, status: 'connected', message: 'Controller input connected and ready.', bluetooth };
    }
    if (connectedDevice?.connected && !connectedDevice.controller) {
      return { ok: true, status: 'connected', message: 'Connected', bluetooth };
    }
    return {
      ok: true,
      status: 'paired',
      message: connectedDevice?.connected
        ? 'Bluetooth is linked, but controller input is not active yet. Keep the controller on, press PS / Home once, then select Check Input.'
        : 'Paired. Press the PS / Home button once to connect controller input.',
      bluetooth
    };
  } catch (error) {
    const bluetooth = await scanBluetoothDevices(false);
    return { ok: false, status: 'failed', message: safeError(error), bluetooth };
  }
}

export async function disconnectBluetoothDevice(deviceId: string): Promise<BluetoothActionResult> {
  if (!/^[0-9a-f]{12}$/i.test(deviceId)) {
    const bluetooth = await scanBluetoothDevices(false);
    return { ok: false, status: 'device-not-found', message: 'Device not found. Scan again and retry.', bluetooth };
  }
  try {
    const result = await runPowerShell<RawBluetoothAction>(DISCONNECT_SCRIPT, { NXGS_BLUETOOTH_DEVICE_ID: deviceId });
    const bluetooth = await scanBluetoothDevices(false);
    if (!asBoolean(result.found)) {
      return { ok: false, status: 'device-not-found', message: 'Device not found. Scan again and retry.', bluetooth };
    }
    if (!asBoolean(result.success)) {
      return { ok: false, status: 'failed', message: windowsDisconnectError(String(result.status ?? 'unknown')), bluetooth };
    }
    return {
      ok: true,
      status: 'disconnected',
      message: 'Disconnected. The device remains paired and can be reconnected later.',
      bluetooth
    };
  } catch (error) {
    const bluetooth = await scanBluetoothDevices(false);
    return { ok: false, status: 'failed', message: safeError(error), bluetooth };
  }
}

export async function removeBluetoothDevice(deviceId: string): Promise<BluetoothActionResult> {
  if (!/^[0-9a-f]{12}$/i.test(deviceId)) {
    const bluetooth = await scanBluetoothDevices(false);
    return { ok: false, status: 'device-not-found', message: 'Device not found. Scan again and retry.', bluetooth };
  }
  try {
    const result = await runPowerShell<RawBluetoothAction>(REMOVE_SCRIPT, { NXGS_BLUETOOTH_DEVICE_ID: deviceId });
    const bluetooth = await scanBluetoothDevices(false);
    if (!asBoolean(result.found)) {
      return { ok: false, status: 'device-not-found', message: 'Device not found. It may already have been removed.', bluetooth };
    }
    if (!asBoolean(result.success)) {
      return { ok: false, status: 'failed', message: windowsRemoveError(String(result.status ?? 'unknown')), bluetooth };
    }
    return {
      ok: true,
      status: 'removed',
      message: 'Bluetooth device removed. Scan and pair it again if you want to use it later.',
      bluetooth
    };
  } catch (error) {
    const bluetooth = await scanBluetoothDevices(false);
    return { ok: false, status: 'failed', message: safeError(error), bluetooth };
  }
}
