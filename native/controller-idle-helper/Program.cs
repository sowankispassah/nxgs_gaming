using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32.SafeHandles;

namespace Nxgs.ControllerIdleHelper
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            Console.OutputEncoding = new UTF8Encoding(false);
            if (args.Length == 1 && args[0] == "--self-test")
            {
                return DualSenseInput.SelfTest() ? WriteSelfTest(true) : WriteSelfTest(false);
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using (var monitor = new RawInputMonitor())
            {
                monitor.Start();
                Application.Run();
            }
            return 0;
        }

        private static int WriteSelfTest(bool ok)
        {
            Console.WriteLine(ok ? "SELF_TEST|OK" : "SELF_TEST|FAIL");
            return ok ? 0 : 1;
        }
    }

    internal sealed class ControllerState
    {
        public IntPtr Handle;
        public string Id;
        public string Name;
        public string Path;
        public string Address;
        public bool Announced;
        public DateTime LastRawInputUtc;
        public DateTime LastMeaningfulInputUtc;
        public DateTime LastActivityEventUtc;
    }

    internal sealed class RawInputMonitor : NativeWindow, IDisposable
    {
        private const int WmInput = 0x00FF;
        private const int WmInputDeviceChange = 0x00FE;
        private const int WmClose = 0x0010;
        private const uint RidevInputSink = 0x00000100;
        private const uint RidevDevNotify = 0x00002000;
        private const uint RidInput = 0x10000003;
        private const uint RidiDeviceName = 0x20000007;
        private const uint RidiDeviceInfo = 0x2000000B;
        private const uint RimTypeHid = 2;
        private const ushort SonyVendorId = 0x054C;
        private static readonly HashSet<ushort> SupportedProducts = new HashSet<ushort> { 0x0CE6, 0x0DF2 };
        private static readonly Regex BluetoothAddressPattern = new Regex("(?:DEV_|BLUETOOTHDEVICE_)([0-9A-F]{12})", RegexOptions.IgnoreCase | RegexOptions.Compiled);
        private readonly object sync = new object();
        private readonly object outputSync = new object();
        private readonly Dictionary<IntPtr, ControllerState> controllers = new Dictionary<IntPtr, ControllerState>();
        private readonly Dictionary<string, ControllerState> controllersById = new Dictionary<string, ControllerState>(StringComparer.OrdinalIgnoreCase);
        private System.Threading.Timer reconcileTimer;
        private Thread commandThread;
        private volatile bool stopping;
        private int stickDeadZone = 32;
        private int triggerThreshold = 15;

        public void Start()
        {
            var parameters = new CreateParams();
            parameters.Caption = "NXGS DualSense Idle Monitor";
            parameters.Parent = new IntPtr(-3); // HWND_MESSAGE
            CreateHandle(parameters);

            var devices = new[]
            {
                new RawInputDevice { UsagePage = 0x01, Usage = 0x04, Flags = RidevInputSink | RidevDevNotify, Target = Handle },
                new RawInputDevice { UsagePage = 0x01, Usage = 0x05, Flags = RidevInputSink | RidevDevNotify, Target = Handle }
            };
            if (!Native.RegisterRawInputDevices(devices, (uint)devices.Length, (uint)Marshal.SizeOf(typeof(RawInputDevice))))
            {
                Emit("ERROR", "HID-0000000000000000", Uri.EscapeDataString("RegisterRawInputDevices failed: " + Marshal.GetLastWin32Error()));
            }

            ReconcileDevices();
            reconcileTimer = new System.Threading.Timer(_ => ReconcileDevices(), null, 2000, 2000);
            commandThread = new Thread(ReadCommands) { IsBackground = true, Name = "NXGS controller idle IPC" };
            commandThread.Start();
            Emit("READY", "1");
        }

        protected override void WndProc(ref Message message)
        {
            if (message.Msg == WmInput)
            {
                ProcessRawInput(message.LParam);
            }
            else if (message.Msg == WmInputDeviceChange)
            {
                ThreadPool.QueueUserWorkItem(_ => ReconcileDevices());
            }
            else if (message.Msg == WmClose)
            {
                stopping = true;
                Application.ExitThread();
                return;
            }
            base.WndProc(ref message);
        }

        private void ReadCommands()
        {
            try
            {
                string line;
                while (!stopping && (line = Console.ReadLine()) != null)
                {
                    if (line == "STOP")
                    {
                        stopping = true;
                        Native.PostMessage(Handle, WmClose, IntPtr.Zero, IntPtr.Zero);
                        return;
                    }
                    var parts = line.Split('|');
                    if (parts.Length == 3 && parts[0] == "CONFIG")
                    {
                        int deadZone;
                        int trigger;
                        if (Int32.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out deadZone)
                            && Int32.TryParse(parts[2], NumberStyles.None, CultureInfo.InvariantCulture, out trigger)
                            && deadZone >= 8 && deadZone <= 80 && trigger >= 1 && trigger <= 100)
                        {
                            stickDeadZone = deadZone;
                            triggerThreshold = trigger;
                        }
                        else
                        {
                            Emit("ERROR", "HID-0000000000000000", Uri.EscapeDataString("Invalid CONFIG command"));
                        }
                        continue;
                    }
                    if (parts.Length == 2 && parts[0] == "SHUTDOWN" && Regex.IsMatch(parts[1], "^(?:[0-9A-F]{12}|HID-[0-9A-F]{16})$"))
                    {
                        ShutdownController(parts[1]);
                        continue;
                    }
                    Emit("ERROR", "HID-0000000000000000", Uri.EscapeDataString("Rejected malformed IPC command"));
                }
            }
            catch (Exception error)
            {
                if (!stopping) Emit("ERROR", "HID-0000000000000000", Uri.EscapeDataString(error.Message));
            }
        }

        private void ShutdownController(string id)
        {
            ControllerState controller;
            lock (sync)
            {
                controllersById.TryGetValue(id, out controller);
            }
            if (controller == null || !controller.Announced)
            {
                EmitShutdown(id, false, 1168, "IOCTL_BTH_DISCONNECT_DEVICE", "controller-not-tracked");
                return;
            }
            // The state was admitted only after VID/PID and Bluetooth transport checks.
            if (String.IsNullOrEmpty(controller.Address))
            {
                EmitShutdown(id, false, 1168, "IOCTL_BTH_DISCONNECT_DEVICE", "bluetooth-address-unavailable");
                return;
            }
            int code;
            var ok = BluetoothDisconnect.TryDisconnect(controller.Address, out code);
            EmitShutdown(id, ok, code, "IOCTL_BTH_DISCONNECT_DEVICE", ok ? "paired-link-disconnected" : "windows-bluetooth-error");
            if (ok)
            {
                MarkDisconnected(controller, "shutdown");
            }
        }

        private void ProcessRawInput(IntPtr rawInputHandle)
        {
            uint size = 0;
            var headerSize = (uint)Marshal.SizeOf(typeof(RawInputHeader));
            if (Native.GetRawInputData(rawInputHandle, RidInput, IntPtr.Zero, ref size, headerSize) == UInt32.MaxValue || size < headerSize + 8 || size > 65536) return;
            var buffer = Marshal.AllocHGlobal((int)size);
            try
            {
                if (Native.GetRawInputData(rawInputHandle, RidInput, buffer, ref size, headerSize) != size) return;
                var header = (RawInputHeader)Marshal.PtrToStructure(buffer, typeof(RawInputHeader));
                if (header.Type != RimTypeHid) return;
                ControllerState controller;
                lock (sync)
                {
                    controllers.TryGetValue(header.Device, out controller);
                }
                if (controller == null)
                {
                    ReconcileDevices();
                    lock (sync) controllers.TryGetValue(header.Device, out controller);
                    if (controller == null) return;
                }
                var receivedAt = DateTime.UtcNow;
                controller.LastRawInputUtc = receivedAt;
                if (!controller.Announced)
                {
                    controller.Announced = true;
                    Emit("CONNECTED", controller.Id, Uri.EscapeDataString(controller.Name), "bluetooth", String.IsNullOrEmpty(controller.Address) ? "unknown" : controller.Address);
                }
                var dataOffset = Marshal.SizeOf(typeof(RawInputHeader));
                var reportSize = Marshal.ReadInt32(buffer, dataOffset);
                var reportCount = Marshal.ReadInt32(buffer, dataOffset + 4);
                if (reportSize <= 0 || reportSize > 512 || reportCount <= 0 || reportCount > 32) return;
                var report = new byte[reportSize];
                var reportData = IntPtr.Add(buffer, dataOffset + 8);
                for (var index = 0; index < reportCount; index++)
                {
                    Marshal.Copy(IntPtr.Add(reportData, index * reportSize), report, 0, reportSize);
                    if (!DualSenseInput.IsMeaningful(report, stickDeadZone, triggerThreshold)) continue;
                    var now = receivedAt;
                    controller.LastMeaningfulInputUtc = now;
                    if ((now - controller.LastActivityEventUtc).TotalMilliseconds < 750) continue;
                    controller.LastActivityEventUtc = now;
                    Emit("ACTIVITY", controller.Id, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString(CultureInfo.InvariantCulture));
                }
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }

        private void ReconcileDevices()
        {
            if (stopping) return;
            try
            {
                uint count = 0;
                var itemSize = (uint)Marshal.SizeOf(typeof(RawInputDeviceList));
                if (Native.GetRawInputDeviceList(null, ref count, itemSize) != 0 || count > 4096) return;
                var list = new RawInputDeviceList[count];
                if (count > 0 && Native.GetRawInputDeviceList(list, ref count, itemSize) == UInt32.MaxValue) return;
                var seen = new HashSet<IntPtr>();
                foreach (var item in list)
                {
                    if (item.Type != RimTypeHid) continue;
                    var info = new RawInputDeviceInfo { Size = (uint)Marshal.SizeOf(typeof(RawInputDeviceInfo)) };
                    uint infoSize = info.Size;
                    if (Native.GetRawInputDeviceInfo(item.Device, RidiDeviceInfo, ref info, ref infoSize) == UInt32.MaxValue) continue;
                    if (info.Hid.VendorId != SonyVendorId || !SupportedProducts.Contains((ushort)info.Hid.ProductId)) continue;
                    var path = GetDeviceName(item.Device);
                    if (!IsBluetoothPath(path)) continue;
                    seen.Add(item.Device);
                    lock (sync)
                    {
                        if (controllers.ContainsKey(item.Device)) continue;
                    }
                    var address = ResolveBluetoothAddress(path);
                    var id = String.IsNullOrEmpty(address) ? "HID-" + StableHash(path) : address;
                    var name = GetProductName(path);
                    var state = new ControllerState
                    {
                        Handle = item.Device,
                        Id = id,
                        Name = name,
                        Path = path,
                        Address = address,
                        Announced = false,
                        LastRawInputUtc = DateTime.MinValue,
                        LastMeaningfulInputUtc = DateTime.UtcNow,
                        LastActivityEventUtc = DateTime.MinValue
                    };
                    lock (sync)
                    {
                        controllers[item.Device] = state;
                        controllersById[id] = state;
                    }
                }

                List<ControllerState> removed;
                lock (sync)
                {
                    removed = controllers.Where(pair => !seen.Contains(pair.Key)).Select(pair => pair.Value).ToList();
                    foreach (var state in removed)
                    {
                        controllers.Remove(state.Handle);
                        controllersById.Remove(state.Id);
                    }
                }
                foreach (var state in removed)
                {
                    if (state.Announced) Emit("DISCONNECTED", state.Id, Uri.EscapeDataString("device-change"));
                }
                List<ControllerState> timedOut;
                lock (sync)
                {
                    var now = DateTime.UtcNow;
                    timedOut = controllers.Values.Where(state => state.Announced && (now - state.LastRawInputUtc).TotalSeconds >= 5).ToList();
                    foreach (var state in timedOut) state.Announced = false;
                }
                foreach (var state in timedOut) Emit("DISCONNECTED", state.Id, Uri.EscapeDataString("input-timeout"));
            }
            catch (Exception error)
            {
                Emit("ERROR", "HID-0000000000000000", Uri.EscapeDataString(error.Message));
            }
        }

        private static bool IsBluetoothPath(string path)
        {
            return !String.IsNullOrEmpty(path)
                && (path.IndexOf("{00001124-0000-1000-8000-00805f9b34fb}", StringComparison.OrdinalIgnoreCase) >= 0
                    || path.IndexOf("VID&0002054C", StringComparison.OrdinalIgnoreCase) >= 0
                    || path.IndexOf("BTHENUM", StringComparison.OrdinalIgnoreCase) >= 0);
        }

        private static string ResolveBluetoothAddress(string path)
        {
            var match = BluetoothAddressPattern.Match(path ?? String.Empty);
            if (match.Success) return match.Groups[1].Value.ToUpperInvariant();
            using (var handle = Native.CreateFile(path, 0, 3, IntPtr.Zero, 3, 0, IntPtr.Zero))
            {
                if (handle.IsInvalid) return String.Empty;
                var serial = new byte[256];
                if (!Native.HidD_GetSerialNumberString(handle, serial, serial.Length)) return String.Empty;
                var text = Encoding.Unicode.GetString(serial).TrimEnd('\0').Replace(":", String.Empty).Replace("-", String.Empty);
                return Regex.IsMatch(text, "^[0-9A-F]{12}$", RegexOptions.IgnoreCase) ? text.ToUpperInvariant() : String.Empty;
            }
        }

        private static string GetProductName(string path)
        {
            using (var handle = Native.CreateFile(path, 0, 3, IntPtr.Zero, 3, 0, IntPtr.Zero))
            {
                if (!handle.IsInvalid)
                {
                    var product = new byte[256];
                    if (Native.HidD_GetProductString(handle, product, product.Length))
                    {
                        var name = Encoding.Unicode.GetString(product).TrimEnd('\0').Trim();
                        if (!String.IsNullOrEmpty(name)) return name;
                    }
                }
            }
            return "DualSense Wireless Controller";
        }

        private static string GetDeviceName(IntPtr device)
        {
            uint characters = 0;
            Native.GetRawInputDeviceInfo(device, RidiDeviceName, IntPtr.Zero, ref characters);
            if (characters == 0 || characters > 32768) return String.Empty;
            var buffer = Marshal.AllocHGlobal(((int)characters + 1) * 2);
            try
            {
                return Native.GetRawInputDeviceInfo(device, RidiDeviceName, buffer, ref characters) == UInt32.MaxValue
                    ? String.Empty
                    : Marshal.PtrToStringUni(buffer);
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }

        private static string StableHash(string value)
        {
            using (var sha = SHA256.Create())
            {
                return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(value ?? String.Empty)), 0, 8).Replace("-", String.Empty);
            }
        }

        private void EmitShutdown(string id, bool ok, int code, string action, string detail)
        {
            Emit("SHUTDOWN_RESULT", id, ok ? "OK" : "FAIL", code.ToString(CultureInfo.InvariantCulture), Uri.EscapeDataString(action), Uri.EscapeDataString(detail));
        }

        private void MarkDisconnected(ControllerState controller, string reason)
        {
            var shouldEmit = false;
            lock (sync)
            {
                if (controller.Announced)
                {
                    controller.Announced = false;
                    shouldEmit = true;
                }
            }
            if (shouldEmit) Emit("DISCONNECTED", controller.Id, Uri.EscapeDataString(reason));
        }

        private void Emit(params string[] values)
        {
            lock (outputSync)
            {
                Console.WriteLine(String.Join("|", values));
                Console.Out.Flush();
            }
        }

        public void Dispose()
        {
            stopping = true;
            if (reconcileTimer != null) reconcileTimer.Dispose();
            if (Handle != IntPtr.Zero) DestroyHandle();
        }
    }

    internal static class DualSenseInput
    {
        public static bool IsMeaningful(byte[] report, int stickDeadZone, int triggerThreshold)
        {
            if (report == null || report.Length < 10) return false;
            int axes;
            int triggerLeft;
            int triggerRight;
            int buttons0;
            int buttons1;
            int buttons2;
            if (report[0] == 0x31 && report.Length >= 12)
            {
                var common = 2;
                axes = common;
                triggerLeft = common + 4;
                triggerRight = common + 5;
                buttons0 = common + 7;
                buttons1 = common + 8;
                buttons2 = common + 9;
            }
            else if (report[0] == 0x01 && report.Length >= 10)
            {
                axes = 1;
                buttons0 = 5;
                buttons1 = 6;
                buttons2 = 7;
                triggerLeft = 8;
                triggerRight = 9;
            }
            else
            {
                return false;
            }
            if (buttons2 >= report.Length || triggerRight >= report.Length) return false;
            for (var index = axes; index < axes + 4; index++)
            {
                if (Math.Abs(report[index] - 128) > stickDeadZone) return true;
            }
            if (report[triggerLeft] > triggerThreshold || report[triggerRight] > triggerThreshold) return true;
            var dpad = report[buttons0] & 0x0F;
            return dpad != 8 || (report[buttons0] & 0xF0) != 0 || report[buttons1] != 0 || (report[buttons2] & 0xF7) != 0;
        }

        public static bool SelfTest()
        {
            var neutral = new byte[78];
            neutral[0] = 0x31;
            neutral[2] = neutral[3] = neutral[4] = neutral[5] = 128;
            neutral[9] = 8;
            if (IsMeaningful(neutral, 32, 15)) return false;
            neutral[2] = 145; // drift below the configured dead zone
            if (IsMeaningful(neutral, 32, 15)) return false;
            neutral[2] = 180;
            if (!IsMeaningful(neutral, 32, 15)) return false;
            neutral[2] = 128;
            neutral[10] = 0x01; // L1
            if (!IsMeaningful(neutral, 32, 15)) return false;
            neutral[10] = 0;
            neutral[6] = 20; // trigger
            return IsMeaningful(neutral, 32, 15);
        }
    }

    internal static class BluetoothDisconnect
    {
        private const uint IoctlBthDisconnectDevice = 0x0041000C;

        public static bool TryDisconnect(string addressText, out int code)
        {
            ulong address;
            if (!UInt64.TryParse(addressText, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out address))
            {
                code = 87;
                return false;
            }
            var parameters = new BluetoothFindRadioParams { Size = Marshal.SizeOf(typeof(BluetoothFindRadioParams)) };
            IntPtr radio;
            var find = Native.BluetoothFindFirstRadio(ref parameters, out radio);
            if (find == IntPtr.Zero)
            {
                code = Marshal.GetLastWin32Error();
                return false;
            }
            code = 1;
            try
            {
                do
                {
                    try
                    {
                        int returned;
                        if (Native.DeviceIoControl(radio, IoctlBthDisconnectDevice, ref address, sizeof(ulong), IntPtr.Zero, 0, out returned, IntPtr.Zero))
                        {
                            code = 0;
                            return true;
                        }
                        code = Marshal.GetLastWin32Error();
                        if (code == 1167) return true;
                    }
                    finally
                    {
                        if (radio != IntPtr.Zero) Native.CloseHandle(radio);
                    }
                } while (Native.BluetoothFindNextRadio(find, out radio));
            }
            finally
            {
                Native.BluetoothFindRadioClose(find);
            }
            return false;
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct RawInputDevice { public ushort UsagePage; public ushort Usage; public uint Flags; public IntPtr Target; }
    [StructLayout(LayoutKind.Sequential)]
    internal struct RawInputDeviceList { public IntPtr Device; public uint Type; }
    [StructLayout(LayoutKind.Sequential)]
    internal struct RawInputHeader { public uint Type; public uint Size; public IntPtr Device; public IntPtr WParam; }
    [StructLayout(LayoutKind.Sequential)]
    internal struct RawInputDeviceInfoHid { public uint VendorId; public uint ProductId; public uint VersionNumber; public ushort UsagePage; public ushort Usage; }
    [StructLayout(LayoutKind.Explicit, Size = 32)]
    internal struct RawInputDeviceInfo
    {
        [FieldOffset(0)] public uint Size;
        [FieldOffset(4)] public uint Type;
        [FieldOffset(8)] public RawInputDeviceInfoHid Hid;
    }
    [StructLayout(LayoutKind.Sequential)]
    internal struct BluetoothFindRadioParams { public int Size; }

    internal static class Native
    {
        [DllImport("user32.dll", SetLastError = true)] internal static extern bool RegisterRawInputDevices([In] RawInputDevice[] devices, uint count, uint size);
        [DllImport("user32.dll", SetLastError = true)] internal static extern uint GetRawInputDeviceList([In, Out] RawInputDeviceList[] list, ref uint count, uint size);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern uint GetRawInputDeviceInfo(IntPtr device, uint command, IntPtr data, ref uint size);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern uint GetRawInputDeviceInfo(IntPtr device, uint command, ref RawInputDeviceInfo data, ref uint size);
        [DllImport("user32.dll", SetLastError = true)] internal static extern uint GetRawInputData(IntPtr rawInput, uint command, IntPtr data, ref uint size, uint headerSize);
        [DllImport("user32.dll", SetLastError = true)] internal static extern bool PostMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool CloseHandle(IntPtr handle);
        [DllImport("hid.dll", SetLastError = true)] internal static extern bool HidD_GetProductString(SafeFileHandle device, byte[] buffer, int length);
        [DllImport("hid.dll", SetLastError = true)] internal static extern bool HidD_GetSerialNumberString(SafeFileHandle device, byte[] buffer, int length);
        [DllImport("bthprops.cpl", SetLastError = true)] internal static extern IntPtr BluetoothFindFirstRadio(ref BluetoothFindRadioParams parameters, out IntPtr radio);
        [DllImport("bthprops.cpl", SetLastError = true)] internal static extern bool BluetoothFindNextRadio(IntPtr find, out IntPtr radio);
        [DllImport("bthprops.cpl", SetLastError = true)] internal static extern bool BluetoothFindRadioClose(IntPtr find);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool DeviceIoControl(IntPtr device, uint code, ref ulong input, int inputSize, IntPtr output, int outputSize, out int returned, IntPtr overlapped);
    }
}
