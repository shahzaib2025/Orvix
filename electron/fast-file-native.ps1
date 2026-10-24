$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$inputData=$env:ORVIX_FAST_FILE_INPUT | ConvertFrom-Json
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
public class FastFileWindow {
  public long handle; public int pid; public string app,title,identity,state; public bool active;
  public int x,y,width,height,workX,workY,workWidth,workHeight;
  public int normalX,normalY,normalWidth,normalHeight;
}
public static class FastFileNative {
  delegate bool Callback(IntPtr h,IntPtr p);
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int left,top,right,bottom; }
  [StructLayout(LayoutKind.Sequential)] struct Monitor { public int size; public Rect bounds,work; public uint flags; }
  [StructLayout(LayoutKind.Sequential)] struct Point { public int x,y; }
  [StructLayout(LayoutKind.Sequential)] struct Placement { public int size,flags,show; public Point min,max; public Rect normal; }
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback c,IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out Rect r);
  [DllImport("user32.dll")] static extern bool GetWindowPlacement(IntPtr h,ref Placement p);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h,uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr h,ref Monitor m);
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr h,int n);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint f);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h,int attribute,out int value,int size);
  [DllImport("shlwapi.dll",CharSet=CharSet.Unicode)] static extern uint AssocQueryString(uint f,uint type,string assoc,string extra,StringBuilder result,ref uint n);
  public static string Association(string extension) { uint n=2048; var s=new StringBuilder((int)n); return AssocQueryString(0,2,extension,"open",s,ref n)==0?s.ToString():""; }
  public static List<FastFileWindow> Windows() {
    SetProcessDPIAware();var list=new List<FastFileWindow>();var foreground=GetForegroundWindow();
    EnumWindows((h,p)=>{try{
      if(!IsWindowVisible(h)&&!IsIconic(h))return true;
      int cloaked;if(DwmGetWindowAttribute(h,14,out cloaked,4)==0&&cloaked!=0&&!IsIconic(h))return true;
      var text=new StringBuilder(1024);if(GetWindowText(h,text,text.Capacity)==0)return true;
      uint pid;GetWindowThreadProcessId(h,out pid);string app,identity;
      using(var process=Process.GetProcessById((int)pid)){app=process.ProcessName;identity=pid+":"+process.StartTime.ToUniversalTime().Ticks;}
      Rect r;GetWindowRect(h,out r);var m=new Monitor();m.size=Marshal.SizeOf(m);GetMonitorInfo(MonitorFromWindow(h,2),ref m);
      var placement=new Placement();placement.size=Marshal.SizeOf(placement);GetWindowPlacement(h,ref placement);
      list.Add(new FastFileWindow{handle=h.ToInt64(),pid=(int)pid,app=app,identity=identity,title=text.ToString(),state=IsIconic(h)?"minimized":IsZoomed(h)?"maximized":"normal",active=h==foreground,
        x=r.left,y=r.top,width=r.right-r.left,height=r.bottom-r.top,workX=m.work.left,workY=m.work.top,workWidth=m.work.right-m.work.left,workHeight=m.work.bottom-m.work.top,
        normalX=placement.normal.left+(m.work.left-m.bounds.left),normalY=placement.normal.top+(m.work.top-m.bounds.top),normalWidth=placement.normal.right-placement.normal.left,normalHeight=placement.normal.bottom-placement.normal.top});
    }catch{}return true;},IntPtr.Zero);return list;
  }
  public static bool Apply(FastFileWindow target,string state,int xNormal,int yNormal,int widthNormal,int heightNormal) {
    var h=new IntPtr(target.handle);
    if(state=="minimized"){ShowWindowAsync(h,2);return true;}
    if(state=="maximized"){ShowWindowAsync(h,3);System.Threading.Thread.Sleep(120);SetForegroundWindow(h);return true;}
    if(state=="normal"||state=="focus"){if(state=="normal"){ShowWindowAsync(h,1);System.Threading.Thread.Sleep(80);if(widthNormal>0&&heightNormal>0)SetWindowPos(h,IntPtr.Zero,xNormal,yNormal,widthNormal,heightNormal,0x0040|0x0004);}else if(target.state=="minimized")ShowWindowAsync(h,9);SetForegroundWindow(h);return true;}
    if(!new List<string>{"left","right","top_left","top_right","bottom_left","bottom_right"}.Contains(state))return false;
    ShowWindowAsync(h,1);System.Threading.Thread.Sleep(80);
    int halfW=target.workWidth/2,halfH=target.workHeight/2;
    bool right=state.Contains("right"),bottom=state.StartsWith("bottom"),quarter=state.Contains("_");
    int x=target.workX+(right?halfW:0),y=target.workY+(bottom?halfH:0),w=right?target.workWidth-halfW:halfW,height=quarter?(bottom?target.workHeight-halfH:halfH):target.workHeight;
    SetForegroundWindow(h);return SetWindowPos(h,IntPtr.Zero,x,y,w,height,0x0040|0x0004);
  }
}
'@
$associated=''
if($inputData.path){$associated=[FastFileNative]::Association([IO.Path]::GetExtension([string]$inputData.path))}
$windows=@([FastFileNative]::Windows())
if($inputData.action -eq 'apply'){
  $target=@($windows | Where-Object {$_.handle -eq $inputData.handle -and $_.identity -eq $inputData.identity -and (-not $inputData.expectedTitle -or $_.title -eq $inputData.expectedTitle)})
  if($target.Count -ne 1){@{status='stale_target';windows=$windows} | ConvertTo-Json -Compress -Depth 5;exit}
  $applied=[FastFileNative]::Apply($target[0],[string]$inputData.state,[int]$inputData.restoreBounds.x,[int]$inputData.restoreBounds.y,[int]$inputData.restoreBounds.width,[int]$inputData.restoreBounds.height)
  Start-Sleep -Milliseconds 150
  $windows=@([FastFileNative]::Windows())
  @{status='observed';applied=$applied;windows=$windows;association=$associated} | ConvertTo-Json -Compress -Depth 5
  exit
}
if($inputData.waitMs -gt 0 -and $inputData.path){
  $name=[IO.Path]::GetFileName([string]$inputData.path)
  $stem=[IO.Path]::GetFileNameWithoutExtension([string]$inputData.path)
  $deadline=[DateTime]::UtcNow.AddMilliseconds([Math]::Min(7000,[int]$inputData.waitMs))
  while(-not @($windows | Where-Object {$_.title.IndexOf($name,[StringComparison]::OrdinalIgnoreCase) -ge 0 -or $_.title.IndexOf($stem,[StringComparison]::OrdinalIgnoreCase) -ge 0}).Count -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 160;$windows=@([FastFileNative]::Windows())}
}
@{status='observed';windows=$windows;association=$associated} | ConvertTo-Json -Compress -Depth 5
