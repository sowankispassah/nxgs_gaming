param([Parameter(Mandatory = $true)][int]$ParentProcessId)
$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

public static class NxgsLockdownKeyboardHook {
  private const int WH_KEYBOARD_LL = 13;
  private const int WM_KEYDOWN = 0x0100;
  private const int WM_SYSKEYDOWN = 0x0104;
  private const int PM_REMOVE = 0x0001;
  private const int VK_TAB = 0x09;
  private const int VK_ESCAPE = 0x1B;
  private const int VK_SPACE = 0x20;
  private const int VK_F4 = 0x73;
  private const int VK_LWIN = 0x5B;
  private const int VK_RWIN = 0x5C;
  private const int VK_CONTROL = 0x11;
  private const int VK_MENU = 0x12;
  private const int SW_HIDE = 0;
  private const uint EVENT_OBJECT_SHOW = 0x8002;
  private const uint EVENT_OBJECT_LOCATIONCHANGE = 0x800B;
  private const int OBJID_WINDOW = 0;
  private const uint WINEVENT_OUTOFCONTEXT = 0x0000;
  private const uint WINEVENT_SKIPOWNPROCESS = 0x0002;
  private const uint SWP_NOSIZE = 0x0001;
  private const uint SWP_NOMOVE = 0x0002;
  private const uint SWP_NOACTIVATE = 0x0010;
  private const uint SWP_ASYNCWINDOWPOS = 0x4000;
  private static readonly IntPtr HWND_BOTTOM = new IntPtr(1);

  private delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
  private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
  private delegate void WinEventProc(
    IntPtr hook,
    uint eventType,
    IntPtr hwnd,
    int objectId,
    int childId,
    uint eventThread,
    uint eventTime
  );
  private static HookProc callback = HookCallback;
  private static EnumWindowsProc notificationCallback = SuppressNotificationWindow;
  private static WinEventProc notificationEventCallback = NotificationWindowEvent;
  private static IntPtr hook = IntPtr.Zero;
  private static IntPtr notificationShowHook = IntPtr.Zero;
  private static IntPtr notificationLocationHook = IntPtr.Zero;
  private static readonly System.Collections.Generic.HashSet<IntPtr> reportedNotifications =
    new System.Collections.Generic.HashSet<IntPtr>();

  [StructLayout(LayoutKind.Sequential)] private struct KBDLLHOOKSTRUCT { public uint vkCode, scanCode, flags, time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] private struct POINT { public int x, y; }
  [StructLayout(LayoutKind.Sequential)] private struct MSG { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; }
  [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] private struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }

  [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int idHook, HookProc callback, IntPtr module, uint threadId);
  [DllImport("user32.dll")] private static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax, IntPtr module, WinEventProc callback, uint processId, uint threadId, uint flags);
  [DllImport("user32.dll", SetLastError = true)] private static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] private static extern bool UnhookWinEvent(IntPtr hook);
  [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, System.Text.StringBuilder text, int maxCount);
  [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] private static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] private static extern bool PeekMessage(out MSG message, IntPtr window, uint min, uint max, uint remove);
  [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr hwnd, int command);
  [DllImport("user32.dll")] private static extern bool TranslateMessage(ref MSG message);
  [DllImport("user32.dll")] private static extern IntPtr DispatchMessage(ref MSG message);
  [DllImport("kernel32.dll", CharSet = CharSet.Auto)] private static extern IntPtr GetModuleHandle(string moduleName);

  public static void Run(int parentProcessId) {
    hook = SetWindowsHookEx(WH_KEYBOARD_LL, callback, GetModuleHandle(null), 0);
    if (hook == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    notificationShowHook = SetWinEventHook(
      EVENT_OBJECT_SHOW,
      EVENT_OBJECT_SHOW,
      IntPtr.Zero,
      notificationEventCallback,
      0,
      0,
      WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS
    );
    notificationLocationHook = SetWinEventHook(
      EVENT_OBJECT_LOCATIONCHANGE,
      EVENT_OBJECT_LOCATIONCHANGE,
      IntPtr.Zero,
      notificationEventCallback,
      0,
      0,
      WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS
    );
    if (notificationShowHook == IntPtr.Zero || notificationLocationHook == IntPtr.Zero) {
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    }
    EnumWindows(notificationCallback, IntPtr.Zero);
    Console.WriteLine("READY");
    Console.Out.Flush();
    try {
      while (IsParentAlive(parentProcessId)) {
        MSG message;
        while (PeekMessage(out message, IntPtr.Zero, 0, 0, PM_REMOVE)) { TranslateMessage(ref message); DispatchMessage(ref message); }
        Thread.Sleep(15);
      }
    } finally {
      if (notificationLocationHook != IntPtr.Zero) UnhookWinEvent(notificationLocationHook);
      if (notificationShowHook != IntPtr.Zero) UnhookWinEvent(notificationShowHook);
      if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook);
    }
  }

  private static bool IsParentAlive(int processId) {
    try { return !Process.GetProcessById(processId).HasExited; }
    catch { return false; }
  }

  private static void NotificationWindowEvent(
    IntPtr eventHook,
    uint eventType,
    IntPtr hwnd,
    int objectId,
    int childId,
    uint eventThread,
    uint eventTime
  ) {
    if (hwnd == IntPtr.Zero || objectId != OBJID_WINDOW) return;
    SuppressNotificationWindow(hwnd, IntPtr.Zero);
  }

  private static bool SuppressNotificationWindow(IntPtr hwnd, IntPtr lParam) {
    try {
      if (!IsWindowVisible(hwnd)) return true;
      uint processId;
      GetWindowThreadProcessId(hwnd, out processId);
      if (processId == 0) return true;
      Process process = Process.GetProcessById((int)processId);
      string processName = process.ProcessName;
      if (!IsWindowsShellNotificationHost(processName)) return true;

      System.Text.StringBuilder classNameBuilder = new System.Text.StringBuilder(256);
      GetClassName(hwnd, classNameBuilder, classNameBuilder.Capacity);
      string className = classNameBuilder.ToString();
      if (!IsNotificationSurfaceClass(className)) return true;

      RECT rect;
      if (!GetWindowRect(hwnd, out rect)) return true;
      int width = rect.Right - rect.Left;
      int height = rect.Bottom - rect.Top;
      if (width < 180 || height < 60) return true;

      IntPtr monitor = MonitorFromWindow(hwnd, 2);
      MONITORINFO info = new MONITORINFO();
      info.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
      if (!GetMonitorInfo(monitor, ref info)) return true;
      int monitorWidth = info.rcMonitor.Right - info.rcMonitor.Left;
      int monitorHeight = info.rcMonitor.Bottom - info.rcMonitor.Top;
      bool compactPopup = width < (monitorWidth * 3 / 4) && height < (monitorHeight * 3 / 4);
      bool notificationCorner =
        rect.Right >= info.rcMonitor.Right - 96 &&
        rect.Top >= info.rcMonitor.Top + (monitorHeight / 4);
      if (!compactPopup || !notificationCorner) return true;

      SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS);
      ShowWindowAsync(hwnd, SW_HIDE);
      if (reportedNotifications.Add(hwnd)) {
        Console.WriteLine("NOTIFICATION_SUPPRESSED|" + processName + "|" + className);
        Console.Out.Flush();
      }
    } catch {
      // Shell windows can disappear during enumeration; the next sweep handles replacements.
    }
    return true;
  }

  private static bool IsWindowsShellNotificationHost(string processName) {
    return processName.Equals("ShellExperienceHost", StringComparison.OrdinalIgnoreCase) ||
      processName.Equals("StartMenuExperienceHost", StringComparison.OrdinalIgnoreCase) ||
      processName.Equals("SecurityHealthHost", StringComparison.OrdinalIgnoreCase) ||
      processName.Equals("SecurityHealthSystray", StringComparison.OrdinalIgnoreCase) ||
      processName.Equals("WindowsSecurityHealthService", StringComparison.OrdinalIgnoreCase) ||
      processName.Equals("RuntimeBroker", StringComparison.OrdinalIgnoreCase);
  }

  private static bool IsNotificationSurfaceClass(string className) {
    return className.Equals("Windows.UI.Core.CoreWindow", StringComparison.OrdinalIgnoreCase) ||
      className.Equals("Windows.UI.Composition.DesktopWindowContentBridge", StringComparison.OrdinalIgnoreCase) ||
      className.Equals("ApplicationFrameWindow", StringComparison.OrdinalIgnoreCase) ||
      className.Equals("Xaml_WindowedPopupClass", StringComparison.OrdinalIgnoreCase) ||
      className.IndexOf("Notification", StringComparison.OrdinalIgnoreCase) >= 0;
  }

  private static IntPtr HookCallback(int code, IntPtr wParam, IntPtr lParam) {
    if (code >= 0 && (wParam.ToInt32() == WM_KEYDOWN || wParam.ToInt32() == WM_SYSKEYDOWN)) {
      KBDLLHOOKSTRUCT data = Marshal.PtrToStructure<KBDLLHOOKSTRUCT>(lParam);
      int key = (int)data.vkCode;
      bool control = (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0;
      bool alt = (GetAsyncKeyState(VK_MENU) & 0x8000) != 0;
      string blocked = null;
      if (key == VK_LWIN || key == VK_RWIN) blocked = "Windows key";
      else if (key == VK_ESCAPE && control) blocked = "Ctrl+Esc";
      else if (key == VK_TAB && control) blocked = "Ctrl+Tab";
      else if (key == VK_TAB && alt) blocked = "Alt+Tab";
      else if (key == VK_F4 && alt) blocked = "Alt+F4";
      else if (key == VK_SPACE && alt) blocked = "Alt+Space";
      if (blocked != null) {
        Console.WriteLine(blocked);
        Console.Out.Flush();
        return new IntPtr(1);
      }
    }
    return CallNextHookEx(hook, code, wParam, lParam);
  }
}
"@

[NxgsLockdownKeyboardHook]::Run($ParentProcessId)
