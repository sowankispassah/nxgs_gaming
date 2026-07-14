import { spawn } from 'node:child_process';
import type { DisplayStatus } from '../shared/types';

type RawDisplayFeatures = {
  HdrKnown?: unknown;
  HdrSupported?: unknown;
  HdrEnabled?: unknown;
  HdrControlSupported?: unknown;
  HdrMessage?: unknown;
  CurrentColorProfile?: unknown;
  ColorProfiles?: unknown;
  ColorSwitchSupported?: unknown;
  ColorMessage?: unknown;
};

export type AdvancedDisplayFeatures = Pick<DisplayStatus, 'colorProfile' | 'hdr'>;

const DISPLAY_FEATURE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;

public sealed class NxgsDisplayFeatureSnapshot {
    public bool HdrKnown { get; set; }
    public bool HdrSupported { get; set; }
    public bool HdrEnabled { get; set; }
    public bool HdrControlSupported { get; set; }
    public string HdrMessage { get; set; }
    public string CurrentColorProfile { get; set; }
    public string[] ColorProfiles { get; set; }
    public bool ColorSwitchSupported { get; set; }
    public string ColorMessage { get; set; }
}

public static class NxgsDisplayFeatures {
    private const uint QdcOnlyActivePaths = 2;
    private const uint GetAdvancedColorInfo = 9;
    private const uint SetAdvancedColorState = 10;
    private const uint GetAdvancedColorInfo2 = 15;
    private const uint SetHdrState = 16;
    private const int CurrentUserScope = 1;
    private const int IccProfile = 0;
    private const int NoProfileSubtype = 4;

    [StructLayout(LayoutKind.Sequential)]
    public struct Luid { public uint LowPart; public int HighPart; }

    [StructLayout(LayoutKind.Sequential)]
    public struct Rational { public uint Numerator; public uint Denominator; }

    [StructLayout(LayoutKind.Sequential)]
    public struct PathSourceInfo {
        public Luid AdapterId;
        public uint Id;
        public uint ModeInfoIdx;
        public uint StatusFlags;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PathTargetInfo {
        public Luid AdapterId;
        public uint Id;
        public uint ModeInfoIdx;
        public uint OutputTechnology;
        public uint Rotation;
        public uint Scaling;
        public Rational RefreshRate;
        public uint ScanLineOrdering;
        [MarshalAs(UnmanagedType.Bool)] public bool TargetAvailable;
        public uint StatusFlags;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PathInfo {
        public PathSourceInfo SourceInfo;
        public PathTargetInfo TargetInfo;
        public uint Flags;
    }

    [StructLayout(LayoutKind.Explicit, Size = 48)]
    public struct ModeInfoData { }

    [StructLayout(LayoutKind.Sequential)]
    public struct ModeInfo {
        public uint InfoType;
        public uint Id;
        public Luid AdapterId;
        public ModeInfoData Info;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DeviceInfoHeader {
        public uint Type;
        public uint Size;
        public Luid AdapterId;
        public uint Id;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct AdvancedColorInfo {
        public DeviceInfoHeader Header;
        public uint Value;
        public uint ColorEncoding;
        public uint BitsPerColorChannel;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct AdvancedColorInfo2 {
        public DeviceInfoHeader Header;
        public uint Value;
        public uint ColorEncoding;
        public uint BitsPerColorChannel;
        public uint ActiveColorMode;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct SetColorState {
        public DeviceInfoHeader Header;
        public uint Value;
    }

    [DllImport("user32.dll")]
    private static extern int GetDisplayConfigBufferSizes(uint flags, out uint pathCount, out uint modeCount);

    [DllImport("user32.dll")]
    private static extern int QueryDisplayConfig(uint flags, ref uint pathCount, [Out] PathInfo[] paths, ref uint modeCount, [Out] ModeInfo[] modes, IntPtr topologyId);

    [DllImport("user32.dll", EntryPoint = "DisplayConfigGetDeviceInfo")]
    private static extern int GetAdvancedInfo(ref AdvancedColorInfo packet);

    [DllImport("user32.dll", EntryPoint = "DisplayConfigGetDeviceInfo")]
    private static extern int GetAdvancedInfo2(ref AdvancedColorInfo2 packet);

    [DllImport("user32.dll", EntryPoint = "DisplayConfigSetDeviceInfo")]
    private static extern int SetAdvancedInfo(ref SetColorState packet);

    [DllImport("mscms.dll")]
    private static extern int ColorProfileGetDisplayUserScope(Luid adapterId, uint sourceId, out int scope);

    [DllImport("mscms.dll", CharSet = CharSet.Unicode)]
    private static extern int ColorProfileGetDisplayList(int scope, Luid adapterId, uint sourceId, out IntPtr profileList, out uint profileCount);

    [DllImport("mscms.dll", CharSet = CharSet.Unicode)]
    private static extern int ColorProfileGetDisplayDefault(int scope, Luid adapterId, uint sourceId, int profileType, int profileSubType, out IntPtr profileName);

    [DllImport("mscms.dll", CharSet = CharSet.Unicode)]
    private static extern int ColorProfileSetDisplayDefaultAssociation(int scope, string profileName, int profileType, int profileSubType, Luid adapterId, uint sourceId);

    [DllImport("mscms.dll", CharSet = CharSet.Unicode)]
    private static extern int ColorProfileAddDisplayAssociation(int scope, string profileName, Luid adapterId, uint sourceId, [MarshalAs(UnmanagedType.Bool)] bool setAsDefault, [MarshalAs(UnmanagedType.Bool)] bool associateAsAdvancedColor);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);

    private static DeviceInfoHeader Header(uint type, int size, Luid adapterId, uint id) {
        return new DeviceInfoHeader { Type = type, Size = (uint)size, AdapterId = adapterId, Id = id };
    }

    private static PathInfo PrimaryPath() {
        for (int attempt = 0; attempt < 3; attempt++) {
            uint pathCount;
            uint modeCount;
            int result = GetDisplayConfigBufferSizes(QdcOnlyActivePaths, out pathCount, out modeCount);
            if (result != 0) throw new Win32Exception(result, "Windows could not enumerate active displays");
            var paths = new PathInfo[pathCount];
            var modes = new ModeInfo[modeCount];
            result = QueryDisplayConfig(QdcOnlyActivePaths, ref pathCount, paths, ref modeCount, modes, IntPtr.Zero);
            if (result == 122) continue;
            if (result != 0) throw new Win32Exception(result, "Windows could not query the active display configuration");
            if (pathCount == 0) throw new InvalidOperationException("Windows did not report an active display path.");
            return paths[0];
        }
        throw new InvalidOperationException("The Windows display configuration changed while NXGS was reading it.");
    }

    private static void ReadHdr(PathInfo path, NxgsDisplayFeatureSnapshot snapshot) {
        try {
            var info2 = new AdvancedColorInfo2();
            info2.Header = Header(GetAdvancedColorInfo2, Marshal.SizeOf(typeof(AdvancedColorInfo2)), path.TargetInfo.AdapterId, path.TargetInfo.Id);
            int result = GetAdvancedInfo2(ref info2);
            if (result == 0) {
                snapshot.HdrKnown = true;
                snapshot.HdrSupported = (info2.Value & (1u << 4)) != 0;
                snapshot.HdrEnabled = (info2.Value & (1u << 5)) != 0;
                snapshot.HdrControlSupported = snapshot.HdrSupported && (info2.Value & (1u << 3)) == 0;
                snapshot.HdrMessage = snapshot.HdrSupported
                    ? snapshot.HdrControlSupported ? "Windows HDR control is available." : "HDR is limited by Windows policy or the display driver."
                    : "HDR is not supported on this display.";
                return;
            }

            var info = new AdvancedColorInfo();
            info.Header = Header(GetAdvancedColorInfo, Marshal.SizeOf(typeof(AdvancedColorInfo)), path.TargetInfo.AdapterId, path.TargetInfo.Id);
            result = GetAdvancedInfo(ref info);
            if (result == 0) {
                snapshot.HdrKnown = true;
                snapshot.HdrSupported = (info.Value & 1u) != 0;
                snapshot.HdrEnabled = (info.Value & 2u) != 0;
                snapshot.HdrControlSupported = snapshot.HdrSupported && (info.Value & 8u) == 0;
                snapshot.HdrMessage = snapshot.HdrSupported
                    ? snapshot.HdrControlSupported ? "Windows Advanced Color control is available." : "Advanced Color is disabled by Windows or the display driver."
                    : "HDR is not supported on this display.";
                return;
            }
            snapshot.HdrMessage = new Win32Exception(result).Message;
        } catch (Exception error) {
            snapshot.HdrMessage = error.Message;
        }
    }

    private static string[] ReadProfileList(int scope, PathInfo path) {
        IntPtr list = IntPtr.Zero;
        try {
            uint count;
            int result = ColorProfileGetDisplayList(scope, path.SourceInfo.AdapterId, path.SourceInfo.Id, out list, out count);
            if (result < 0) Marshal.ThrowExceptionForHR(result);
            var profiles = new List<string>();
            for (uint index = 0; index < count; index++) {
                IntPtr namePointer = Marshal.ReadIntPtr(list, checked((int)index * IntPtr.Size));
                string name = Marshal.PtrToStringUni(namePointer);
                if (!String.IsNullOrWhiteSpace(name)) profiles.Add(name);
            }
            return profiles.Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(value => value, StringComparer.OrdinalIgnoreCase).ToArray();
        } finally {
            if (list != IntPtr.Zero) LocalFree(list);
        }
    }

    private static string ReadDefaultProfile(int scope, PathInfo path) {
        IntPtr name = IntPtr.Zero;
        try {
            int result = ColorProfileGetDisplayDefault(scope, path.SourceInfo.AdapterId, path.SourceInfo.Id, IccProfile, NoProfileSubtype, out name);
            if (result < 0) return String.Empty;
            return Marshal.PtrToStringUni(name) ?? String.Empty;
        } finally {
            if (name != IntPtr.Zero) LocalFree(name);
        }
    }

    private static void ReadColorProfiles(PathInfo path, NxgsDisplayFeatureSnapshot snapshot) {
        try {
            int scope;
            if (ColorProfileGetDisplayUserScope(path.SourceInfo.AdapterId, path.SourceInfo.Id, out scope) < 0) scope = CurrentUserScope;
            var profiles = ReadProfileList(scope, path);
            if (profiles.Length == 0 && scope != 0) profiles = ReadProfileList(0, path);
            string colorDirectory = Path.Combine(Environment.SystemDirectory, "spool", "drivers", "color");
            if (Directory.Exists(colorDirectory)) {
                profiles = profiles
                    .Concat(Directory.EnumerateFiles(colorDirectory)
                        .Where(file => file.EndsWith(".icc", StringComparison.OrdinalIgnoreCase) || file.EndsWith(".icm", StringComparison.OrdinalIgnoreCase))
                        .Select(Path.GetFileName))
                    .Where(name => !String.IsNullOrWhiteSpace(name))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
                    .ToArray();
            }
            string current = ReadDefaultProfile(scope, path);
            if (String.IsNullOrWhiteSpace(current) && scope != 0) current = ReadDefaultProfile(0, path);
            snapshot.ColorProfiles = profiles;
            snapshot.CurrentColorProfile = String.IsNullOrWhiteSpace(current) ? "Windows system default" : current;
            snapshot.ColorSwitchSupported = profiles.Length > 0;
            snapshot.ColorMessage = profiles.Length > 0
                ? "Choose an installed profile associated with this display."
                : "Windows did not report selectable color profiles for this display.";
        } catch (EntryPointNotFoundException) {
            snapshot.ColorMessage = "Display color-profile switching requires a newer Windows color-management API.";
        } catch (Exception error) {
            snapshot.ColorMessage = error.Message;
        }
    }

    public static NxgsDisplayFeatureSnapshot GetStatus() {
        var snapshot = new NxgsDisplayFeatureSnapshot {
            HdrKnown = false,
            HdrSupported = false,
            HdrEnabled = false,
            HdrControlSupported = false,
            HdrMessage = "Windows did not expose HDR information for this display.",
            CurrentColorProfile = "Windows system default",
            ColorProfiles = new string[0],
            ColorSwitchSupported = false,
            ColorMessage = "Windows did not expose display color profiles."
        };
        var path = PrimaryPath();
        ReadHdr(path, snapshot);
        ReadColorProfiles(path, snapshot);
        return snapshot;
    }

    public static void SetHdr(bool enabled) {
        var path = PrimaryPath();
        var status = GetStatus();
        if (!status.HdrSupported || !status.HdrControlSupported) throw new InvalidOperationException(status.HdrMessage);
        var packet = new SetColorState();
        packet.Header = Header(SetHdrState, Marshal.SizeOf(typeof(SetColorState)), path.TargetInfo.AdapterId, path.TargetInfo.Id);
        packet.Value = enabled ? 1u : 0u;
        int result = SetAdvancedInfo(ref packet);
        if (result != 0) {
            packet.Header = Header(SetAdvancedColorState, Marshal.SizeOf(typeof(SetColorState)), path.TargetInfo.AdapterId, path.TargetInfo.Id);
            result = SetAdvancedInfo(ref packet);
        }
        if (result != 0) throw new Win32Exception(result, "Windows could not change HDR");
    }

    public static void SetColorProfile(string profileName) {
        if (String.IsNullOrWhiteSpace(profileName)) throw new ArgumentException("Select a color profile.");
        var path = PrimaryPath();
        var status = GetStatus();
        if (!status.ColorProfiles.Contains(profileName, StringComparer.OrdinalIgnoreCase)) {
            throw new InvalidOperationException("That color profile is not associated with this display.");
        }
        int result = ColorProfileSetDisplayDefaultAssociation(CurrentUserScope, profileName, IccProfile, NoProfileSubtype, path.SourceInfo.AdapterId, path.SourceInfo.Id);
        if (result < 0) {
            result = ColorProfileAddDisplayAssociation(CurrentUserScope, profileName, path.SourceInfo.AdapterId, path.SourceInfo.Id, true, false);
        }
        if (result < 0) Marshal.ThrowExceptionForHR(result);
    }
}
'@ | Out-Null

$action = $env:NXGS_DISPLAY_FEATURE_ACTION
if ($action -eq 'set-hdr') {
    [NxgsDisplayFeatures]::SetHdr($env:NXGS_DISPLAY_FEATURE_VALUE -eq 'true')
} elseif ($action -eq 'set-profile') {
    [NxgsDisplayFeatures]::SetColorProfile($env:NXGS_DISPLAY_FEATURE_VALUE)
}
[NxgsDisplayFeatures]::GetStatus() | ConvertTo-Json -Depth 5 -Compress
`;

function normalizeMessage(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeProfiles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((profile): profile is string => typeof profile === 'string' && profile.trim().length > 0);
}

function normalizeFeatures(raw: RawDisplayFeatures): AdvancedDisplayFeatures {
  const profiles = normalizeProfiles(raw.ColorProfiles);
  const hdrKnown = raw.HdrKnown === true;
  const hdrSupported = raw.HdrSupported === true;
  return {
    colorProfile: {
      currentProfile: normalizeMessage(raw.CurrentColorProfile, 'Windows system default'),
      availableProfiles: profiles,
      switchingSupported: raw.ColorSwitchSupported === true && profiles.length > 0,
      message: normalizeMessage(raw.ColorMessage, 'Windows did not expose selectable color profiles.')
    },
    hdr: {
      support: hdrKnown ? hdrSupported ? 'supported' : 'unsupported' : 'unknown',
      enabled: raw.HdrEnabled === true,
      controlSupported: raw.HdrControlSupported === true,
      message: normalizeMessage(raw.HdrMessage, 'Windows did not expose reliable HDR capability information for this display.')
    }
  };
}

async function runFeatureAction(action: 'status' | 'set-hdr' | 'set-profile', value = ''): Promise<AdvancedDisplayFeatures> {
  if (process.platform !== 'win32') {
    return {
      colorProfile: { currentProfile: 'Windows system default', availableProfiles: [], switchingSupported: false, message: 'Color-profile switching is available on supported Windows displays.' },
      hdr: { support: 'unknown', enabled: false, controlSupported: false, message: 'HDR control is available on supported Windows displays.' }
    };
  }
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '$script = [Console]::In.ReadToEnd(); & ([ScriptBlock]::Create($script))'],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NXGS_DISPLAY_FEATURE_ACTION: action, NXGS_DISPLAY_FEATURE_VALUE: value } }
    );
    let output = '';
    let diagnostics = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Windows display features did not respond in time.'));
    }, 20000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { output += chunk; });
    child.stderr.on('data', (chunk: string) => { diagnostics += chunk; });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0 && output.trim()) resolve(`${output}\n${diagnostics}`);
      else reject(new Error(diagnostics.trim() || `Windows display feature process exited with code ${code ?? 'unknown'}.`));
    });
    child.stdin.end(`${DISPLAY_FEATURE_SCRIPT}\n\n`);
  });
  const jsonStart = stdout.lastIndexOf('{"HdrKnown"');
  const jsonEnd = stdout.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd <= jsonStart) throw new Error('Windows did not return display feature data.');
  return normalizeFeatures(JSON.parse(stdout.slice(jsonStart, jsonEnd + 1)) as RawDisplayFeatures);
}

export async function getAdvancedDisplayFeatures(): Promise<AdvancedDisplayFeatures> {
  return runFeatureAction('status');
}

export async function changeHdr(enabled: boolean): Promise<AdvancedDisplayFeatures> {
  return runFeatureAction('set-hdr', enabled ? 'true' : 'false');
}

export async function changeColorProfile(profileName: string): Promise<AdvancedDisplayFeatures> {
  return runFeatureAction('set-profile', profileName);
}
