# Read-only Store window diagnostics; never changes focus, geometry, or visibility.
param([string[]]$Titles = @('Angry Birds 2', 'Hill Climb Racing'))
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class StoreWindowDiagnostics {
  public delegate bool Callback(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Callback c, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, Callback c, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumThreadWindows(uint thread, Callback c, IntPtr p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string t);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetTopWindow(IntPtr parent);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint command);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowBand(IntPtr h, out uint band);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int n);
  [StructLayout(LayoutKind.Sequential)] public struct Key { public Guid id; public uint pid; }
  [StructLayout(LayoutKind.Explicit, Size=24)] public struct Value { [FieldOffset(0)] public ushort type; [FieldOffset(8)] public IntPtr pointer; }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface Store { int Count(out uint n); int At(uint i, out Key k); [PreserveSig] int Get(ref Key k, out Value v); }
  [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr h, ref Guid id, out Store s);
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref Value v);
  public static string AppId(IntPtr h) {
    var id = typeof(Store).GUID; Store s;
    if (SHGetPropertyStoreForWindow(h, ref id, out s) != 0) return "";
    try { var k = new Key { id = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 }; Value v;
      if (s.Get(ref k, out v) != 0) return "";
      try { return v.type == 31 ? Marshal.PtrToStringUni(v.pointer) : ""; } finally { PropVariantClear(ref v); }
    } finally { Marshal.ReleaseComObject(s); }
  }
}
'@
$rows = [Collections.Generic.List[object]]::new()
$collected = [Collections.Generic.HashSet[long]]::new()
$collect = [StoreWindowDiagnostics+Callback]{ param($h,$unused)
  if ($h -eq [IntPtr]::Zero -or -not $collected.Add($h.ToInt64())) { return $true }
  [uint32]$owner = 0
  [StoreWindowDiagnostics]::GetWindowThreadProcessId($h,[ref]$owner) | Out-Null
  $proc = Get-Process -Id $owner -ErrorAction SilentlyContinue
  $title = [Text.StringBuilder]::new(512)
  $class = [Text.StringBuilder]::new(256)
  [StoreWindowDiagnostics]::GetWindowText($h,$title,512) | Out-Null
  [StoreWindowDiagnostics]::GetClassName($h,$class,256) | Out-Null
  if ($class.ToString() -notmatch 'ApplicationFrame|CoreWindow' -and $proc.ProcessName -notmatch 'Angry|Hill|electron|NXGS Play') { return $true }
  [uint32]$band=0
  [StoreWindowDiagnostics]::GetWindowBand($h,[ref]$band) | Out-Null
  [int]$cloak = 0
  [StoreWindowDiagnostics]::DwmGetWindowAttribute($h,14,[ref]$cloak,4) | Out-Null
  $children = [Collections.Generic.List[string]]::new()
  [StoreWindowDiagnostics]::EnumChildWindows($h,{param($c,$unusedChild)
    [uint32]$childOwner=0
    [StoreWindowDiagnostics]::GetWindowThreadProcessId($c,[ref]$childOwner) | Out-Null
    $children.Add("$c/$childOwner")
    return $true
  },[IntPtr]::Zero) | Out-Null
  $rows.Add([pscustomobject]@{ handle=$h.ToInt64(); process=$proc.ProcessName; pid=$owner; title=$title.ToString(); class=$class.ToString(); visible=[StoreWindowDiagnostics]::IsWindowVisible($h); enabled=[StoreWindowDiagnostics]::IsWindowEnabled($h); band=$band; root=[StoreWindowDiagnostics]::GetAncestor($h,2).ToInt64(); foreground=($h -eq [StoreWindowDiagnostics]::GetForegroundWindow()); cloaked=$cloak; appId=[StoreWindowDiagnostics]::AppId($h); children=($children -join ',') })
  return $true
}
[StoreWindowDiagnostics]::EnumWindows($collect,[IntPtr]::Zero) | Out-Null
$collect.Invoke([StoreWindowDiagnostics]::GetForegroundWindow(),[IntPtr]::Zero) | Out-Null
foreach ($taskTitle in $Titles) {
  $collect.Invoke([StoreWindowDiagnostics]::FindWindow('ApplicationFrameWindow',$taskTitle),[IntPtr]::Zero) | Out-Null
  $collect.Invoke([StoreWindowDiagnostics]::FindWindow('Windows.UI.Core.CoreWindow',$taskTitle),[IntPtr]::Zero) | Out-Null
}
$seen = [Collections.Generic.HashSet[long]]::new()
$after = [StoreWindowDiagnostics]::GetTopWindow([IntPtr]::Zero)
for ($i=0; $i -lt 2048; $i++) {
  if ($after -eq [IntPtr]::Zero -or -not $seen.Add($after.ToInt64())) { break }
  $collect.Invoke($after,[IntPtr]::Zero) | Out-Null
  $after = [StoreWindowDiagnostics]::GetWindow($after,2)
}
Get-Process | Where-Object { $_.ProcessName -match 'Angry|Hill' } | ForEach-Object {
  $_.Threads | ForEach-Object { [StoreWindowDiagnostics]::EnumThreadWindows($_.Id,$collect,[IntPtr]::Zero) | Out-Null }
}
$rows | ConvertTo-Json -Depth 3
