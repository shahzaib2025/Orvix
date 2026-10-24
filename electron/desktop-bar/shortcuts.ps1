param([ValidateSet('Search', 'Lock')][string]$Action)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class QuickDeckShortcuts {
    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool LockWorkStation();
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
}
'@

if ($Action -eq 'Lock') {
    if (-not [QuickDeckShortcuts]::LockWorkStation()) { throw 'Windows could not lock this session.' }
} else {
    try {
        [QuickDeckShortcuts]::keybd_event(0x5B, 0, 0, [UIntPtr]::Zero)
        [QuickDeckShortcuts]::keybd_event(0x53, 0, 0, [UIntPtr]::Zero)
    } finally {
        [QuickDeckShortcuts]::keybd_event(0x53, 0, 2, [UIntPtr]::Zero)
        [QuickDeckShortcuts]::keybd_event(0x5B, 0, 2, [UIntPtr]::Zero)
    }
}
