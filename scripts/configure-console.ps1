param([switch]$Report, [int]$ConsoleProcessId = 0, [switch]$WaitForConsoleProcess)

# Brand this console without changing its inherited font or layout settings.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OrvixConsole {
    [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
    [DllImport("kernel32.dll")] public static extern bool FreeConsole();
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool AttachConsole(uint processId);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool SetConsoleIcon(IntPtr icon);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr LoadImage(IntPtr instance, string name, uint type, int width, int height, uint flags);
    [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr icon);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
}
'@

$script:consoleIcon = [IntPtr]::Zero
if ($ConsoleProcessId -gt 0) {
    # PowerShell initializes in a detached console first. Attaching only now avoids
    # its startup changing the visible CMD window's inherited font.
    [void][OrvixConsole]::FreeConsole()
    if (-not [OrvixConsole]::AttachConsole($ConsoleProcessId)) {
        if ($Report) { @{ attached = $false; attachError = [Runtime.InteropServices.Marshal]::GetLastWin32Error() } | ConvertTo-Json -Compress }
        exit 1
    }
}
function Initialize-OrvixConsole {
    $consoleWindow = [OrvixConsole]::GetConsoleWindow()
    if ($consoleWindow -eq [IntPtr]::Zero) { return @{ attached = $false } }
    $iconPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'build\icons\icon.ico'
    $script:consoleIcon = [OrvixConsole]::LoadImage([IntPtr]::Zero, $iconPath, 1, 0, 0, 0x50)
    $iconConfigured = $false
    if ($script:consoleIcon -ne [IntPtr]::Zero) {
        $iconConfigured = [OrvixConsole]::SetConsoleIcon($script:consoleIcon)
        if (-not $iconConfigured) {
            # Modern console hosts may not implement the legacy console-icon API.
            $previous = [IntPtr]::Zero
            [void][OrvixConsole]::SendMessageTimeout($consoleWindow, 0x80, [IntPtr]::Zero, $script:consoleIcon, 2, 1000, [ref]$previous)
            [void][OrvixConsole]::SendMessageTimeout($consoleWindow, 0x80, [IntPtr]1, $script:consoleIcon, 2, 1000, [ref]$previous)
            $current = [IntPtr]::Zero
            [void][OrvixConsole]::SendMessageTimeout($consoleWindow, 0x7f, [IntPtr]1, [IntPtr]::Zero, 2, 1000, [ref]$current)
            $iconConfigured = $current -eq $script:consoleIcon
        }
    }
    return @{ attached = $true; iconLoaded = ($script:consoleIcon -ne [IntPtr]::Zero);
              iconConfigured = $iconConfigured }
}

try {
    $settings = Initialize-OrvixConsole
    if ($Report) { $settings | ConvertTo-Json -Compress }
    if ($WaitForConsoleProcess -and $ConsoleProcessId -gt 0) {
        Wait-Process -Id $ConsoleProcessId -ErrorAction SilentlyContinue
    }
} finally {
    # Retain icon ownership for the entire visible terminal session.
    if ($script:consoleIcon -ne [IntPtr]::Zero) { [void][OrvixConsole]::DestroyIcon($script:consoleIcon) }
}
