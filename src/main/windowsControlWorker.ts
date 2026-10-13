import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { GamePresentationSnapshot } from './gamePresentation';
import { trustedNativeInputToken } from './trustedNativeInput';

export type WindowsControlCommand =
  | 'volume'
  | 'mute'
  | 'brightness'
  | 'escape'
  | 'focus-window'
  | 'activate-store-app'
  | 'inspect-window'
  | 'find-store-window'
  | 'stage-overlay'
  | 'release-window'
  | 'close-window'
  | 'hide-game'
  | 'taskbar-visible';

export interface WindowsControlResult {
  ok: boolean;
  value?: number | boolean;
  presentation?: GamePresentationSnapshot;
  message: string;
  handles?: number[];
  window?: {
    handle: number;
    processId: number;
    processName: string;
    hostProcessId: number;
    hostProcessName: string;
    className: string;
    title: string;
  };
}

export interface HideGameRequest {
  handle: number;
  processId: number;
  processName: string;
  appUserModelId?: string;
}

type PendingRequest = {
  resolve: (result: WindowsControlResult) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export interface OverlayStageRequest {
  overlayHandle: number;
  gameHandle: number;
  minimizeGameAfterPaint?: boolean;
}

export interface StoreWindowRequest {
  processId: number;
  title: string;
  appUserModelId: string;
}

const WORKER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
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
    [ComImport, Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")]
    private class ApplicationActivationManager { }
    [ComImport, Guid("2E941141-7F97-4756-BA1D-9DECDE894A3D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IApplicationActivationManager {
        [PreserveSig] int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appId,
            [MarshalAs(UnmanagedType.LPWStr)] string arguments, uint options, out uint processId);
    }
    [DllImport("ole32.dll")] private static extern int CoAllowSetForegroundWindow(
        [MarshalAs(UnmanagedType.IUnknown)] object manager, IntPtr reserved);
    public static uint ActivateStoreApp(string appId) {
        var manager = (IApplicationActivationManager)new ApplicationActivationManager();
        try {
            AllowSetForegroundWindow(-1);
            CoAllowSetForegroundWindow(manager, IntPtr.Zero);
            uint processId;
            Marshal.ThrowExceptionForHR(manager.ActivateApplication(appId, null, 2, out processId));
            return processId;
        } finally { Marshal.ReleaseComObject(manager); }
    }
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int value, int size);
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct MonitorInfo { public int Size; public Rect Bounds, Work; public uint Flags; }
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] private static extern bool GetWindowBand(IntPtr window, out uint band);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
    [DllImport("user32.dll")] private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] private static extern IntPtr GetWindowLongPtr64(IntPtr window, int index);
    [DllImport("user32.dll", EntryPoint="GetWindowLongW")] private static extern int GetWindowLong32(IntPtr window, int index);
    [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW")] private static extern IntPtr SetWindowLongPtr64(IntPtr window, int index, IntPtr value);
    [DllImport("user32.dll", EntryPoint="SetWindowLongW")] private static extern int SetWindowLong32(IntPtr window, int index, int value);
    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);
    private static long WindowStyle(IntPtr window, int index) {
        return IntPtr.Size == 8 ? GetWindowLongPtr64(window, index).ToInt64() : GetWindowLong32(window, index);
    }
    private static void SetWindowStyle(IntPtr window, int index, long value) {
        if (IntPtr.Size == 8) SetWindowLongPtr64(window, index, new IntPtr(value));
        else SetWindowLong32(window, index, unchecked((int)value));
    }
    public static object Presentation(long handle) {
        var window = new IntPtr(handle);
        Rect rect;
        var monitor = new MonitorInfo();
        monitor.Size = Marshal.SizeOf(typeof(MonitorInfo));
        if (!IsWindow(window) || !GetWindowRect(window, out rect) ||
            !GetMonitorInfo(MonitorFromWindow(window, 2), ref monitor)) return null;
        var foreground = GetForegroundWindow();
        int cloaked;
        bool isCloaked = DwmGetWindowAttribute(window, 14, out cloaked, 4) != 0 || cloaked != 0;
        uint band;
        var bandRead = GetWindowBand(window, out band);
        return new {
            foregroundHandle = foreground.ToInt64(), isForeground = foreground == window,
            isVisible = IsWindowVisible(window), isMinimized = IsIconic(window), isCloaked = isCloaked,
            windowBand = bandRead ? (int)band : -1,
            hasWindowChrome = (WindowStyle(window, -16) & 0x00CF0000L) != 0 ||
                (WindowStyle(window, -20) & 0x00060301L) != 0,
            x = rect.Left, y = rect.Top, width = rect.Right - rect.Left, height = rect.Bottom - rect.Top,
            monitorX = monitor.Bounds.Left, monitorY = monitor.Bounds.Top,
            monitorWidth = monitor.Bounds.Right - monitor.Bounds.Left,
            monitorHeight = monitor.Bounds.Bottom - monitor.Bounds.Top,
            taskbarVisible = TaskbarVisible()
        };
    }
    private static bool TaskbarVisible() {
        foreach (var className in new[] { "Shell_TrayWnd", "Shell_SecondaryTrayWnd" }) {
            var after = IntPtr.Zero;
            while ((after = FindWindowEx(IntPtr.Zero, after, className, null)) != IntPtr.Zero) {
                if (IsWindowVisible(after)) return true;
            }
        }
        return false;
    }
    [DllImport("user32.dll")] private static extern bool AllowSetForegroundWindow(int processId);
    [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint attach, uint attachTo, bool attachState);
    [DllImport("user32.dll")] private static extern bool BringWindowToTop(IntPtr window);
    [DllImport("user32.dll", SetLastError=true)] private static extern IntPtr FindWindow(string className, string windowName);
    [DllImport("user32.dll", SetLastError=true)] private static extern IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string className, string windowName);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] private static extern bool EnableWindow(IntPtr window, bool enabled);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern IntPtr SetActiveWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr SetFocus(IntPtr window);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr window, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
    private delegate bool EnumWindowProc(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowProc callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumWindowProc callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool SystemParametersInfo(uint action, uint parameter, ref uint value, uint flags);
    [DllImport("dwmapi.dll")] private static extern int DwmFlush();
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr window, uint attribute, out uint value, int size);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int virtualKey);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);

    private const uint KeyUp = 0x0002;
    private const uint ExtendedKey = 0x0001;
    // Window band 8 is Windows' immersive full-screen band, above every
    // desktop window including NXGS's topmost overlay.
    private const uint ImmersiveBand = 8;
    // Allow retries on later Home presses, but stop toggling a window that
    // never leaves immersive full screen.
    private const int MaxImmersiveToggleFailures = 4;
    private static readonly Dictionary<long, int> FailedImmersiveWindowToggles = new Dictionary<long, int>();
    private const uint NoSize = 0x0001;
    private const uint NoMove = 0x0002;
    private const uint NoZOrder = 0x0004;
    private const uint NoActivate = 0x0010;
    private const uint FrameChanged = 0x0020;
    private const uint ShowWindowFlag = 0x0040;
    private const uint WindowClose = 0x0010;
    private const uint PreviousWindow = 3;

    [StructLayout(LayoutKind.Sequential)] public struct PropertyKey { public Guid id; public uint pid; }
    [StructLayout(LayoutKind.Explicit, Size=24)] public struct PropertyValue { [FieldOffset(0)] public ushort type; [FieldOffset(8)] public IntPtr pointer; }
    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface PropertyStore { int Count(out uint n); int At(uint i, out PropertyKey k); [PreserveSig] int Get(ref PropertyKey k, out PropertyValue v); }
    [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr h, ref Guid id, out PropertyStore s);
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropertyValue v);
    private static bool HasAppId(IntPtr h, string appId) {
        if (String.IsNullOrEmpty(appId)) return false;
        var id = typeof(PropertyStore).GUID; PropertyStore s;
        if (SHGetPropertyStoreForWindow(h, ref id, out s) != 0) return false;
        try { var k = new PropertyKey { id = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 }; PropertyValue v;
            if (s.Get(ref k, out v) != 0) return false;
            try { return v.type == 31 && String.Equals(Marshal.PtrToStringUni(v.pointer), appId, StringComparison.OrdinalIgnoreCase); }
            finally { PropVariantClear(ref v); }
        } finally { Marshal.ReleaseComObject(s); }
    }
    public static System.Collections.Generic.Dictionary<string, object> FindStoreWindow(int processId, string title, string appId) {
        if (processId <= 0 || String.IsNullOrWhiteSpace(title) || String.IsNullOrWhiteSpace(appId)) return null;
        var frame = FindWindow("ApplicationFrameWindow", title);
        if (frame == IntPtr.Zero || !IsWindow(frame) || !IsWindowVisible(frame) || !HasAppId(frame, appId)) return null;
        uint cloaked = 0;
        if (DwmGetWindowAttribute(frame, 14, out cloaked, sizeof(uint)) == 0 && cloaked != 0) return null;
        uint hostProcessId;
        GetWindowThreadProcessId(frame, out hostProcessId);
        if (hostProcessId == 0) return null;
        try {
            using (var host = System.Diagnostics.Process.GetProcessById((int)hostProcessId))
            using (var package = System.Diagnostics.Process.GetProcessById(processId)) {
                if (!String.Equals(host.ProcessName, "ApplicationFrameHost", StringComparison.OrdinalIgnoreCase)) return null;
                return new System.Collections.Generic.Dictionary<string, object> {
                    { "handle", frame.ToInt64() },
                    { "processId", processId },
                    { "processName", package.ProcessName },
                    { "hostProcessId", (int)hostProcessId },
                    { "hostProcessName", host.ProcessName },
                    { "className", "ApplicationFrameWindow" },
                    { "title", title }
                };
            }
        } catch (ArgumentException) {
            return null;
        }
    }
    public static long[] HideGame(long handle, int processId, string processName, string appId) {
        var hidden = new System.Collections.Generic.List<long>();
        System.Diagnostics.Process process;
        try { process = System.Diagnostics.Process.GetProcessById(processId); }
        catch (ArgumentException) { return hidden.ToArray(); }
        using (process) {
            if (!String.Equals(process.ProcessName, System.IO.Path.GetFileNameWithoutExtension(processName), StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Tracked game process identity changed.");
        }
        // Shared Windows hosts must never be hidden by process ID alone.
        bool sharedHost = String.Equals(processName, "ApplicationFrameHost", StringComparison.OrdinalIgnoreCase) ||
            String.Equals(processName, "ApplicationFrameHost.exe", StringComparison.OrdinalIgnoreCase);
        bool failed = false;
        var seen = new System.Collections.Generic.HashSet<long>();
        EnumWindowProc hide = delegate(IntPtr candidate, IntPtr unused) {
            if (!IsWindow(candidate) || !seen.Add(candidate.ToInt64())) return true;
            uint owner;
            GetWindowThreadProcessId(candidate, out owner);
            bool matches = owner == (uint)processId && (!sharedHost || candidate.ToInt64() == handle);
            if (!matches && candidate.ToInt64() == handle && HasAppId(candidate, appId)) {
                try { using (var host = System.Diagnostics.Process.GetProcessById((int)owner)) {
                    matches = String.Equals(host.ProcessName, "ApplicationFrameHost", StringComparison.OrdinalIgnoreCase);
                } } catch (ArgumentException) { }
            }
            if (!matches && !sharedHost) {
                EnumChildWindows(candidate, delegate(IntPtr child, IntPtr childUnused) {
                    uint childOwner;
                    GetWindowThreadProcessId(child, out childOwner);
                    if (childOwner == (uint)processId) matches = true;
                    return !matches;
                }, IntPtr.Zero);
            }
            if (matches) {
                if (IsWindowVisible(candidate)) {
                    SetWindowPos(candidate, new IntPtr(-2), 0, 0, 0, 0, NoSize | NoMove | NoActivate);
                    ShowWindow(candidate, 0);
                    if (IsWindowVisible(candidate)) failed = true;
                }
                hidden.Add(candidate.ToInt64());
            }
            return true;
        };
        // Immersive package frames can be absent from EnumWindows.
        hide(new IntPtr(handle), IntPtr.Zero);
        EnumWindows(hide, IntPtr.Zero);
        if (failed) throw new InvalidOperationException("Game window did not hide.");
        return hidden.ToArray();
    }

    public static bool FocusWindow(long handle) {
        var window = new IntPtr(handle);
        if (window == IntPtr.Zero || !IsWindow(window)) return false;
        EnableWindow(window, true);
        SetTaskbarVisible(false);
        var currentThread = GetCurrentThreadId();
        uint targetProcess, foregroundProcess;
        var targetThread = GetWindowThreadProcessId(window, out targetProcess);
        var foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), out foregroundProcess);
        var attachedTarget = false;
        var attachedForeground = false;
        try {
            if (currentThread != targetThread) attachedTarget = AttachThreadInput(currentThread, targetThread, true);
            if (foregroundThread != 0 && foregroundThread != targetThread && foregroundThread != currentThread)
                attachedForeground = AttachThreadInput(currentThread, foregroundThread, true);
            AllowSetForegroundWindow(-1);
            // SW_RESTORE changes maximized/Store geometry even when already visible.
            if (IsIconic(window)) ShowWindow(window, 9);
            SetWindowPos(window, new IntPtr(-1), 0, 0, 0, 0, NoSize | NoMove | ShowWindowFlag);
            BringWindowToTop(window);
            SetActiveWindow(window);
            SetForegroundWindow(window);
            SetFocus(window);
            return GetForegroundWindow() == window;
        } finally {
            if (attachedForeground) AttachThreadInput(currentThread, foregroundThread, false);
            if (attachedTarget) AttachThreadInput(currentThread, targetThread, false);
        }
    }

    // Physical Home chords (Ctrl+Shift+H) are usually still held when Home
    // stages, so Windows would see Ctrl+Shift+Win+Enter instead of its
    // full-screen toggle. Release held modifiers before injecting it.
    private static void ReleaseHeldModifiers(UIntPtr trustedInput) {
        foreach (var key in new byte[] { 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5 }) {
            if ((GetAsyncKeyState(key) & 0x8000) == 0) continue;
            keybd_event(key, 0, KeyUp | (key == 0xA3 || key == 0xA5 ? ExtendedKey : 0), UIntPtr.Zero);
        }
        foreach (var key in new byte[] { 0x5B, 0x5C }) {
            if ((GetAsyncKeyState(key) & 0x8000) != 0) keybd_event(key, 0, KeyUp | ExtendedKey, trustedInput);
        }
    }

    // Windows applies its full-screen toggle to the foreground app only. When
    // Home already owns foreground, bring back the exact game first; activation
    // also uncloaks an immersive frame that Windows hid behind NXGS.
    private static bool ActivateForImmersiveToggle(IntPtr window) {
        if (GetForegroundWindow() == window) return true;
        var currentThread = GetCurrentThreadId();
        uint targetProcess;
        var targetThread = GetWindowThreadProcessId(window, out targetProcess);
        var attached = targetThread != 0 && targetThread != currentThread &&
            AttachThreadInput(currentThread, targetThread, true);
        try {
            if (IsIconic(window)) ShowWindow(window, 9);
            SetWindowPos(window, new IntPtr(-1), 0, 0, 0, 0, NoSize | NoMove | ShowWindowFlag);
            BringWindowToTop(window);
            SetActiveWindow(window);
            SetForegroundWindow(window);
            SetFocus(window);
            for (var wait = 0; wait < 25 && GetForegroundWindow() != window; wait += 1) {
                System.Threading.Thread.Sleep(10);
            }
            return GetForegroundWindow() == window;
        } finally {
            if (attached) AttachThreadInput(currentThread, targetThread, false);
        }
    }

    // Leaving immersive full screen makes ApplicationFrameHost restore the
    // windowed frame: title bar styles, no topmost, maximized work-area
    // bounds. Reapply the gameplay handoff's borderless cover presentation so
    // no title bar or NXGS shell edge shows under Home.
    private static void ApplyBorderlessCover(IntPtr window) {
        var monitor = new MonitorInfo();
        monitor.Size = Marshal.SizeOf(typeof(MonitorInfo));
        if (!GetMonitorInfo(MonitorFromWindow(window, 2), ref monitor)) return;
        SetWindowStyle(window, -16, (WindowStyle(window, -16) & ~0x00CF0000L) | 0x80000000L | 0x10000000L);
        SetWindowStyle(window, -20, WindowStyle(window, -20) & ~0x00060301L);
        var doNotRound = 1;
        var noBorderColor = -2;
        DwmSetWindowAttribute(window, 33, ref doNotRound, 4);
        DwmSetWindowAttribute(window, 34, ref noBorderColor, 4);
        uint ownerProcess;
        GetWindowThreadProcessId(window, out ownerProcess);
        var frameHost = false;
        try {
            using (var owner = System.Diagnostics.Process.GetProcessById((int)ownerProcess)) {
                frameHost = String.Equals(owner.ProcessName, "ApplicationFrameHost", StringComparison.OrdinalIgnoreCase);
            }
        } catch (ArgumentException) { }
        // Same geometry as the launch handoff: a small overscan, and the Store
        // frame's own title bar pushed above the display.
        const int overscan = 2;
        var chromeOffset = frameHost
            ? Math.Max(36, GetSystemMetrics(4) + GetSystemMetrics(33) + GetSystemMetrics(92) + 8)
            : 0;
        var bounds = monitor.Bounds;
        SetWindowPos(window, IntPtr.Zero, bounds.Left - overscan, bounds.Top - overscan - chromeOffset,
            bounds.Right - bounds.Left + overscan * 2, bounds.Bottom - bounds.Top + overscan * 2 + chromeOffset,
            NoZOrder | NoActivate | FrameChanged | ShowWindowFlag);
    }

    // Windows' UWP full-screen toggle (Win+Shift+Enter) moves an immersive
    // Store game into the desktop band, so it keeps rendering live underneath
    // NXGS Home. The kiosk hook permits only this tagged injected Windows-key
    // press; physical presses stay blocked.
    private static bool LeaveImmersiveFullscreen(IntPtr game, UIntPtr trustedInput) {
        uint band;
        if (!GetWindowBand(game, out band) || band != ImmersiveBand) return true;
        int failures;
        FailedImmersiveWindowToggles.TryGetValue(game.ToInt64(), out failures);
        if (failures >= MaxImmersiveToggleFailures) return false;
        Rect immersiveRect;
        GetWindowRect(game, out immersiveRect);
        if (ActivateForImmersiveToggle(game)) {
            ReleaseHeldModifiers(trustedInput);
            keybd_event(0x10, 0, 0, UIntPtr.Zero);
            keybd_event(0x5B, 0, 0, trustedInput);
            keybd_event(0x0D, 0, 0, UIntPtr.Zero);
            keybd_event(0x0D, 0, KeyUp, UIntPtr.Zero);
            keybd_event(0x5B, 0, KeyUp, trustedInput);
            keybd_event(0x10, 0, KeyUp, UIntPtr.Zero);
            for (var wait = 0; wait < 50; wait += 1) {
                if (GetWindowBand(game, out band) && band != ImmersiveBand) break;
                System.Threading.Thread.Sleep(10);
            }
        }
        if (band == ImmersiveBand) {
            FailedImmersiveWindowToggles[game.ToInt64()] = failures + 1;
            return false;
        }
        FailedImmersiveWindowToggles.Remove(game.ToInt64());
        // ApplicationFrameHost restores the windowed frame in steps over about
        // 50 ms after the band switch (styles, topmost, then bounds). Wait for
        // it to settle; covering earlier would be undone by those steps.
        Rect lastRect = immersiveRect;
        var lastStyle = WindowStyle(game, -16);
        var lastExStyle = WindowStyle(game, -20);
        var boundsRestored = false;
        var stableMs = 0;
        for (var elapsed = 0; elapsed < 400 && stableMs < (boundsRestored ? 40 : 120); elapsed += 10) {
            System.Threading.Thread.Sleep(10);
            Rect rect;
            GetWindowRect(game, out rect);
            var style = WindowStyle(game, -16);
            var exStyle = WindowStyle(game, -20);
            var changed = rect.Left != lastRect.Left || rect.Top != lastRect.Top || rect.Right != lastRect.Right ||
                rect.Bottom != lastRect.Bottom || style != lastStyle || exStyle != lastExStyle;
            if (rect.Left != immersiveRect.Left || rect.Top != immersiveRect.Top ||
                rect.Right != immersiveRect.Right || rect.Bottom != immersiveRect.Bottom) boundsRestored = true;
            stableMs = changed ? 0 : stableMs + 10;
            lastRect = rect;
            lastStyle = style;
            lastExStyle = exStyle;
        }
        ApplyBorderlessCover(game);
        return true;
    }

    private static bool IsShownOnScreen(IntPtr window) {
        uint cloaked = 0;
        return window != IntPtr.Zero && IsWindow(window) && IsWindowVisible(window) && !IsIconic(window) &&
            !(DwmGetWindowAttribute(window, 14, out cloaked, sizeof(uint)) == 0 && cloaked != 0);
    }

    public static string StageOverlay(long overlayHandle, long gameHandle, bool minimizeGameAfterPaint, string trustedInputToken) {
        var overlay = new IntPtr(overlayHandle);
        var game = new IntPtr(gameHandle);
        if (overlay == IntPtr.Zero || !IsWindow(overlay)) return "invalid_overlay";
        // Store apps may publish a CoreWindow child while ApplicationFrameHost
        // owns the actual desktop z-order. Only the verified child's root can
        // be ordered relative to Electron's top-level overlay.
        if (game != IntPtr.Zero && IsWindow(game)) {
            var root = GetAncestor(game, 2);
            if (root != IntPtr.Zero && IsWindow(root)) game = root;
        }
        var trustedInput = new UIntPtr(Convert.ToUInt64(trustedInputToken, 16));

        var currentThread = GetCurrentThreadId();
        var foregroundBefore = GetForegroundWindow();
        uint foregroundProcess = 0;
        uint overlayProcess = 0;
        var foregroundThread = foregroundBefore == IntPtr.Zero
            ? 0
            : GetWindowThreadProcessId(foregroundBefore, out foregroundProcess);
        var overlayThread = GetWindowThreadProcessId(overlay, out overlayProcess);
        var attachedForeground = false;
        var attachedOverlay = false;
        var attachedOverlayToForeground = false;
        uint foregroundLockTimeout = 0;
        var foregroundLockTimeoutRead = SystemParametersInfo(0x2000, 0, ref foregroundLockTimeout, 0);
        try {
            if (foregroundThread != 0 && foregroundThread != currentThread) {
                attachedForeground = AttachThreadInput(currentThread, foregroundThread, true);
            }
            if (overlayThread != 0 && overlayThread != currentThread) {
                attachedOverlay = AttachThreadInput(currentThread, overlayThread, true);
            }
            if (
                overlayThread != 0 &&
                foregroundThread != 0 &&
                overlayThread != foregroundThread
            ) {
                attachedOverlayToForeground = AttachThreadInput(overlayThread, foregroundThread, true);
            }

            AllowSetForegroundWindow(-1);
            uint unlockedTimeout = 0;
            SystemParametersInfo(0x2001, 0, ref unlockedTimeout, 0);
            var result = StageOverlayOnce(overlay, game, minimizeGameAfterPaint, trustedInput);
            uint band;
            if (result != "ok" && !minimizeGameAfterPaint && game != IntPtr.Zero && IsWindow(game) &&
                GetWindowBand(game, out band) && band == ImmersiveBand) {
                // Windows cloaks an immersive game once another window takes
                // foreground. Retry once: the game is reactivated, leaves
                // immersive full screen, and Home is staged above it again.
                result = StageOverlayOnce(overlay, game, minimizeGameAfterPaint, trustedInput);
            }
            return result;
        } finally {
            if (foregroundLockTimeoutRead) {
                SystemParametersInfo(0x2001, 0, ref foregroundLockTimeout, 0);
            }
            if (attachedOverlayToForeground) AttachThreadInput(overlayThread, foregroundThread, false);
            if (attachedOverlay) AttachThreadInput(currentThread, overlayThread, false);
            if (attachedForeground) AttachThreadInput(currentThread, foregroundThread, false);
        }
    }

    private static string StageOverlayOnce(IntPtr overlay, IntPtr game, bool minimizeGameAfterPaint, UIntPtr trustedInput) {
        try {
            if (game != IntPtr.Zero && IsWindow(game)) {
                EnableWindow(game, true);
                if (!minimizeGameAfterPaint) LeaveImmersiveFullscreen(game, trustedInput);
                if (IsIconic(game) && !minimizeGameAfterPaint) ShowWindowAsync(game, 9);
                if (!minimizeGameAfterPaint) {
                    SetWindowPos(game, new IntPtr(-1), 0, 0, 0, 0, NoSize | NoMove | NoActivate | ShowWindowFlag);
                }
                // The game is never hidden during Home. If overlay activation
                // fails, the only surface Windows can reveal is still the game.
            }

            // Cover the display before changing the tracked game's visibility
            // so no desktop or unrelated app can appear between the two.
            ShowWindow(overlay, 5);
            SetWindowPos(overlay, new IntPtr(-1), 0, 0, 0, 0, NoSize | NoMove | ShowWindowFlag);
            keybd_event(0x12, 0, 0, UIntPtr.Zero);
            BringWindowToTop(overlay);
            if (!IsWindowVisible(overlay)) return "overlay_not_visible";
            if (minimizeGameAfterPaint && game != IntPtr.Zero && IsWindow(game)) {
                // The renderer has already acknowledged an exact game frame.
                // Commit that frame before moving a composition-locked Store
                // surface behind it, so no desktop or unrelated app can flash.
                DwmFlush();
                SetWindowPos(game, new IntPtr(-2), 0, 0, 0, 0, NoSize | NoMove | NoActivate);
                ShowWindow(game, 6);
                // ApplicationFrameHost applies minimize asynchronously. Wait
                // only for that exact tracked window instead of rejecting the
                // first Home press while Windows is still committing it.
                for (var wait = 0; wait < 30 && !IsIconic(game); wait += 1) {
                    System.Threading.Thread.Sleep(15);
                }
            }
            SetActiveWindow(overlay);
            SetForegroundWindow(overlay);
            SetFocus(overlay);
            if (GetForegroundWindow() != overlay) {
                BringWindowToTop(overlay);
                SetForegroundWindow(overlay);
                SetFocus(overlay);
            }
            keybd_event(0x12, 0, KeyUp, UIntPtr.Zero);
            // Reassert the final z-order after foreground activation because
            // some Store frames promote themselves while handling WM_ACTIVATE.
            SetWindowPos(overlay, new IntPtr(-1), 0, 0, 0, 0, NoSize | NoMove | ShowWindowFlag);

            var gameMinimized = game != IntPtr.Zero && IsWindow(game) && IsIconic(game);
            var overlayAboveGame = minimizeGameAfterPaint && gameMinimized;
            if (!minimizeGameAfterPaint && game != IntPtr.Zero && IsWindow(game) && GetForegroundWindow() == overlay) {
                // Immersive frames may be omitted from GetWindow's z-order
                // traversal. Ask Windows to place this exact frame directly
                // behind the focused topmost overlay, and check its result.
                overlayAboveGame = SetWindowPos(game, overlay, 0, 0, 0, 0, NoSize | NoMove | NoActivate);
            }
            if (!overlayAboveGame && game != IntPtr.Zero && IsWindow(game)) {
                overlayAboveGame = false;
                var cursor = GetWindow(game, PreviousWindow);
                var guard = 0;
                while (cursor != IntPtr.Zero && guard < 4096) {
                    if (cursor == overlay) {
                        overlayAboveGame = true;
                        break;
                    }
                    cursor = GetWindow(cursor, PreviousWindow);
                    guard += 1;
                }
            }

            var visible = IsWindowVisible(overlay);
            var foreground = GetForegroundWindow();
            var gameVisible = IsShownOnScreen(game);
            uint band = 0;
            var bandRead = game != IntPtr.Zero && IsWindow(game) && GetWindowBand(game, out band);
            // A frame that just left immersive full screen can stay cloaked for
            // a few compositor frames while Windows moves it between bands.
            for (var wait = 0; !minimizeGameAfterPaint && !gameVisible && bandRead && band != ImmersiveBand && wait < 15; wait += 1) {
                System.Threading.Thread.Sleep(20);
                gameVisible = IsShownOnScreen(game);
            }
            var bandDetail = ";band=" + (bandRead ? band.ToString() : "unknown");
            if (!minimizeGameAfterPaint && !gameVisible) return "game_not_visible_or_cloaked" + bandDetail;
            if (visible && overlayAboveGame && (foreground == overlay || gameMinimized)) {
                DwmFlush();
                return "ok";
            }
            return "foreground=" + foreground.ToInt64() +
                ";visible=" + visible +
                ";above=" + overlayAboveGame +
                ";gameMinimized=" + gameMinimized + bandDetail;
        } finally {
            keybd_event(0x12, 0, KeyUp, UIntPtr.Zero);
        }
    }

    public static bool ReleaseWindow(long handle) {
        var window = new IntPtr(handle);
        if (window == IntPtr.Zero || !IsWindow(window)) return false;
        EnableWindow(window, true);
        return SetWindowPos(window, new IntPtr(-2), 0, 0, 0, 0, NoSize | NoMove | NoActivate);
    }

    public static bool CloseWindow(long handle) {
        var window = new IntPtr(handle);
        return window != IntPtr.Zero && IsWindow(window) &&
            PostMessage(window, WindowClose, IntPtr.Zero, IntPtr.Zero);
    }

    public static bool SetTaskbarVisible(bool visible) {
        var command = visible ? 5 : 0;
        var found = false;
        foreach (var className in new[] { "Shell_TrayWnd", "Shell_SecondaryTrayWnd" }) {
            var main = FindWindow(className, null);
            if (main != IntPtr.Zero) {
                ShowWindow(main, command);
                found = true;
            }

            var after = IntPtr.Zero;
            while (true) {
                var window = FindWindowEx(IntPtr.Zero, after, className, null);
                if (window == IntPtr.Zero) break;
                ShowWindow(window, command);
                found = true;
                after = window;
            }
        }
        return found;
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
        } elseif ($request.command -eq 'activate-store-app') {
            $processId = [NxgsWarningInput]::ActivateStoreApp([string]$request.value)
            $response = @{ id = $request.id; ok = $true; value = $processId; message = 'Store app activated by its exact app identifier.' }
        } elseif ($request.command -eq 'inspect-window') {
            $presentation = [NxgsWarningInput]::Presentation([long]$request.value)
            $response = @{ id = $request.id; ok = ($null -ne $presentation); presentation = $presentation; message = 'Window presentation inspected.' }
        } elseif ($request.command -eq 'find-store-window') {
            $foundWindow = [NxgsWarningInput]::FindStoreWindow([int]$request.value.processId, [string]$request.value.title, [string]$request.value.appUserModelId)
            $response = @{ id = $request.id; ok = ($null -ne $foundWindow); window = $foundWindow; message = 'Exact Store game window inspected.' }
        } elseif ($request.command -eq 'focus-window') {
            $handle = [long]$request.value
            $focused = [NxgsWarningInput]::FocusWindow($handle)
            $response = @{ id = $request.id; ok = $focused; value = $focused; presentation = [NxgsWarningInput]::Presentation($handle); message = $(if ($focused) { 'Game window focused.' } else { 'Game window focus was not confirmed.' }) }
        } elseif ($request.command -eq 'stage-overlay') {
            $overlayHandle = [long]$request.value.overlayHandle
            $gameHandle = [long]$request.value.gameHandle
            $minimizeGameAfterPaint = [bool]$request.value.minimizeGameAfterPaint
            $stageDetail = [NxgsWarningInput]::StageOverlay($overlayHandle, $gameHandle, $minimizeGameAfterPaint, [string]$request.value.trustedInputToken)
            $staged = $stageDetail -eq 'ok'
            $response = @{ id = $request.id; ok = $staged; value = $staged; message = $(if ($staged) { 'Quick overlay staged above the tracked game.' } else { "Quick overlay z-order was not confirmed ($stageDetail)." }) }
        } elseif ($request.command -eq 'release-window') {
            $handle = [long]$request.value
            $released = [NxgsWarningInput]::ReleaseWindow($handle)
            $response = @{ id = $request.id; ok = $released; value = $released; message = $(if ($released) { 'Game window topmost state released.' } else { 'Game window could not be released.' }) }
        } elseif ($request.command -eq 'hide-game') {
            $handles = [NxgsWarningInput]::HideGame([long]$request.value.handle, [int]$request.value.processId, [string]$request.value.processName, [string]$request.value.appUserModelId)
            $response = @{ id = $request.id; ok = $true; handles = @($handles); message = 'Tracked game windows hidden.' }
        } elseif ($request.command -eq 'close-window') {
            $handle = [long]$request.value
            $closed = [NxgsWarningInput]::CloseWindow($handle)
            $response = @{ id = $request.id; ok = $closed; value = $closed; message = $(if ($closed) { 'Game close request posted.' } else { 'Game close request was not accepted.' }) }
        } elseif ($request.command -eq 'taskbar-visible') {
            $value = [bool]$request.value
            $updated = [NxgsWarningInput]::SetTaskbarVisible($value)
            $response = @{ id = $request.id; ok = $updated; value = $value; message = $(if ($updated) { $(if ($value) { 'Windows taskbar restored.' } else { 'Windows taskbar hidden.' }) } else { 'Windows taskbar window was not found.' }) }
        } else {
            throw "Unknown NXGS control command: $($request.command)"
        }
    } catch {
        $response = @{ id = $(if ($null -ne $request) { $request.id } else { 0 }); ok = $false; message = $_.Exception.Message }
    }
    [Console]::Out.WriteLine(($response | ConvertTo-Json -Depth 5 -Compress))
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

  const activeWorker = spawn(
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
  worker = activeWorker;
  stdoutBuffer = '';
  activeWorker.stdout.setEncoding('utf8');
  activeWorker.stderr.resume();
  activeWorker.stdout.on('data', (chunk: string) => {
    if (worker !== activeWorker) return;
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
            request.resolve({ ok: result.ok, value: result.value, handles: result.handles, presentation: result.presentation, window: result.window, message: result.message });
          }
        } catch {
          // Ignore non-JSON PowerShell diagnostics; the request timeout reports a useful failure.
        }
      }
      newline = stdoutBuffer.indexOf('\n');
    }
  });
  activeWorker.once('error', (error) => {
    if (worker !== activeWorker) return;
    rejectPending(`Live control failed: ${error.message}`);
    worker = null;
  });
  activeWorker.once('exit', () => {
    if (worker !== activeWorker) return;
    rejectPending('Live control stopped unexpectedly.');
    worker = null;
  });
  return activeWorker;
}

export function warmWindowsControlWorker(): void {
  if (process.platform === 'win32') ensureWorker();
}

export function runWindowsControl(
  command: WindowsControlCommand,
  value: number | boolean | string | OverlayStageRequest | HideGameRequest | StoreWindowRequest
): Promise<WindowsControlResult> {
  if (process.platform !== 'win32') {
    return Promise.resolve({ ok: false, message: 'System controls are unavailable on this device.' });
  }

  const activeWorker = ensureWorker();
  const id = ++nextRequestId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (worker === activeWorker) {
        worker = null;
        rejectPending(`Live control ${command} did not respond in time.`);
        activeWorker.kill();
      }
    }, command === 'stage-overlay' ? 2500 : 7000);
    pending.set(id, { resolve, reject, timeout });
    const requestValue = command === 'stage-overlay'
      ? { ...(value as OverlayStageRequest), trustedInputToken: trustedNativeInputToken }
      : value;
    activeWorker.stdin.write(`${JSON.stringify({ id, command, value: requestValue })}\n`);
  });
}

export function stopWindowsControlWorker(): void {
  if (!worker) return;
  rejectPending('NXGS is closing.');
  worker.kill();
  worker = null;
}
