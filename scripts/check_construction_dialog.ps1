param([Parameter(Mandatory=$true)][int]$ApplicationPid)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class OrvixDialogCheck {
    public static string LastObserved="";
    delegate bool Callback(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback, IntPtr parameter);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window,StringBuilder text,int count);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window,uint message,IntPtr wparam,IntPtr lparam);
    public static bool VerifyAndClose(int applicationPid) {
        bool found=false;
        EnumWindows(delegate(IntPtr window,IntPtr unused) {
            uint pid; GetWindowThreadProcessId(window,out pid);
            if (pid!=(uint)applicationPid) return true;
            var title=new StringBuilder(512); GetWindowText(window,title,512);
            LastObserved=title.ToString()+" (visible="+IsWindowVisible(window).ToString()+")";
            if (title.ToString()!="Orvix \u2014 Restricted access") return true;
            if (!IsWindowVisible(window)) return true;
            found=true;
            // Acknowledge only this test application's own restriction dialog.
            PostMessage(window,0x111,new IntPtr(1),IntPtr.Zero);
            return false;
        },IntPtr.Zero);
        return found;
    }
}
'@
$deadline=[DateTime]::UtcNow.AddSeconds(10)
while ([DateTime]::UtcNow -lt $deadline) {
    if ([OrvixDialogCheck]::VerifyAndClose($ApplicationPid)) { Write-Output 'PASS: native Windows restriction dialog observed and acknowledged in the isolated test app.'; exit 0 }
    Start-Sleep -Milliseconds 100
}
throw ('The isolated application did not show its native restriction dialog. Last owned window: '+[OrvixDialogCheck]::LastObserved)
