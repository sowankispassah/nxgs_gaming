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

  private delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
  private static HookProc callback = HookCallback;
  private static IntPtr hook = IntPtr.Zero;

  [StructLayout(LayoutKind.Sequential)] private struct KBDLLHOOKSTRUCT { public uint vkCode, scanCode, flags, time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] private struct POINT { public int x, y; }
  [StructLayout(LayoutKind.Sequential)] private struct MSG { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; }

  [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int idHook, HookProc callback, IntPtr module, uint threadId);
  [DllImport("user32.dll", SetLastError = true)] private static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] private static extern bool PeekMessage(out MSG message, IntPtr window, uint min, uint max, uint remove);
  [DllImport("user32.dll")] private static extern bool TranslateMessage(ref MSG message);
  [DllImport("user32.dll")] private static extern IntPtr DispatchMessage(ref MSG message);
  [DllImport("kernel32.dll", CharSet = CharSet.Auto)] private static extern IntPtr GetModuleHandle(string moduleName);

  public static void Run(int parentProcessId) {
    hook = SetWindowsHookEx(WH_KEYBOARD_LL, callback, GetModuleHandle(null), 0);
    if (hook == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    Console.WriteLine("READY");
    Console.Out.Flush();
    try {
      while (IsParentAlive(parentProcessId)) {
        MSG message;
        while (PeekMessage(out message, IntPtr.Zero, 0, 0, PM_REMOVE)) { TranslateMessage(ref message); DispatchMessage(ref message); }
        Thread.Sleep(15);
      }
    } finally {
      if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook);
    }
  }

  private static bool IsParentAlive(int processId) {
    try { return !Process.GetProcessById(processId).HasExited; }
    catch { return false; }
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
