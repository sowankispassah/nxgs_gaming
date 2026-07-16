$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class NxgsControllerXInput
{
    [StructLayout(LayoutKind.Sequential)]
    public struct Gamepad
    {
        public ushort Buttons;
        public byte LeftTrigger;
        public byte RightTrigger;
        public short ThumbLX;
        public short ThumbLY;
        public short ThumbRX;
        public short ThumbRY;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct State
    {
        public uint PacketNumber;
        public Gamepad Gamepad;
    }

    [DllImport("xinput1_4.dll", EntryPoint = "XInputGetState")]
    public static extern uint GetState(uint index, out State state);
}
"@

$slots = for ($index = 0; $index -lt 4; $index += 1) {
    $state = New-Object NxgsControllerXInput+State
    $result = [NxgsControllerXInput]::GetState($index, [ref]$state)
    [ordered]@{
        index = $index
        connected = $result -eq 0
        result = [int]$result
    }
}

[ordered]@{
    connected = @($slots | Where-Object { $_.connected }).Count -gt 0
    slots = $slots
} | ConvertTo-Json -Depth 4 -Compress
