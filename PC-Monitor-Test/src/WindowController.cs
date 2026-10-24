using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;

namespace PcMonitorTest {
  public static class WindowController {
    [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetFocus(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr hWnd, bool fUnknown);
    [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int dwProcessId);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr handle, int attribute, out int value, int size);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr handle, StringBuilder text, int max);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumCallback callback, IntPtr value);
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr OpenWindowStation(string lpszWinSta, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll", SetLastError = true)] static extern bool SetProcessWindowStation(IntPtr hWinSta);
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll", SetLastError = true)] static extern bool SetThreadDesktop(IntPtr hDesktop);

    delegate bool EnumCallback(IntPtr handle, IntPtr value);

    const int SW_SHOWNORMAL = 1;
    const int SW_SHOWMINIMIZED = 2;
    const int SW_SHOWMAXIMIZED = 3;
    const int SW_SHOW = 5;
    const int SW_RESTORE = 9;
    const uint WM_CLOSE = 0x0010;
    const byte VK_MENU = 0x12; // Virtual Alt key
    const uint KEYEVENTF_KEYUP = 0x0002;
    const int ASFW_ANY = -1;

    public static void EnsureInteractiveDesktop() {
      try {
        IntPtr w0 = OpenWindowStation("winsta0", false, 0x037F);
        if (w0 != IntPtr.Zero) {
          SetProcessWindowStation(w0);
          IntPtr d0 = OpenDesktop("default", 0, false, 0x01FF);
          if (d0 != IntPtr.Zero) SetThreadDesktop(d0);
        }
      } catch { }
    }

    public static long ForegroundHandle() {
      EnsureInteractiveDesktop();
      return GetForegroundWindow().ToInt64();
    }

    public static WindowActionResult ExecuteAction(string action, long handle, string appName, string titlePattern, List<WindowInfo> cachedWindows = null) {
      EnsureInteractiveDesktop();
      if (String.IsNullOrEmpty(action)) return new WindowActionResult { ok = false, error = "Action must be specified" };
      action = action.Trim().ToLowerInvariant();

      IntPtr targetHWnd = IntPtr.Zero;
      string matchedApp = null;
      string matchedTitle = null;

      // 1. If handle is explicitly provided and valid
      if (handle > 0) {
        IntPtr h = new IntPtr(handle);
        if (IsWindow(h)) {
          targetHWnd = h;
          if (cachedWindows != null) {
            var found = cachedWindows.FirstOrDefault(w => w.Handle == handle);
            if (found != null) { matchedApp = found.App; matchedTitle = found.Title; }
          }
        } else {
          return new WindowActionResult { ok = false, error = "Requested window handle is no longer valid" };
        }
      }

      // 2. Resolve via cachedWindows or fresh enumeration
      if (targetHWnd == IntPtr.Zero) {
        var windows = cachedWindows ?? EnumerateVisibleWindows();
        var candidate = FindCandidate(windows, appName, titlePattern);
        if (candidate != null) {
          targetHWnd = new IntPtr(candidate.Handle);
          matchedApp = candidate.App;
          matchedTitle = candidate.Title;
        }
      }

      if (targetHWnd == IntPtr.Zero) {
        return new WindowActionResult {
          ok = false,
          error = String.Format("Window not found for app '{0}' or title '{1}'", appName ?? "", titlePattern ?? "")
        };
      }

      bool success = false;
      string executed = action;

      switch (action) {
        case "focus":
        case "front":
        case "bringtofront":
        case "activate":
          success = FocusWindow(targetHWnd);
          executed = "focus";
          break;

        case "minimize":
          success = MinimizeWindow(targetHWnd);
          executed = "minimize";
          break;

        case "maximize":
          success = MaximizeWindow(targetHWnd);
          executed = "maximize";
          break;

        case "restore":
          success = RestoreWindow(targetHWnd);
          executed = "restore";
          break;

        case "close":
          success = CloseWindowGracefully(targetHWnd);
          executed = "close";
          break;

        default:
          return new WindowActionResult { ok = false, error = "Unsupported action: " + action };
      }

      bool verified=false;
      for (int attempt=0;attempt<30;attempt++) {
        verified = executed=="close" ? !IsWindow(targetHWnd) : executed=="focus" ? GetForegroundWindow()==targetHWnd : executed=="minimize" ? IsIconic(targetHWnd) : executed=="maximize" ? IsZoomed(targetHWnd) : IsWindow(targetHWnd) && !IsIconic(targetHWnd) && !IsZoomed(targetHWnd);
        if (verified) break;
        System.Threading.Thread.Sleep(10);
      }
      return new WindowActionResult {
        ok = success,
        verified = verified,
        action = executed,
        handle = targetHWnd.ToInt64(),
        app = matchedApp,
        title = matchedTitle
      };
    }

    public static bool FocusWindow(IntPtr hWnd) {
      if (hWnd == IntPtr.Zero || !IsWindow(hWnd)) return false;

      IntPtr currentForeground = GetForegroundWindow();
      if (currentForeground == hWnd) return true;

      try { AllowSetForegroundWindow(ASFW_ANY); } catch {}

      uint currentThreadId = GetCurrentThreadId();
      uint foregroundThreadId = 0;
      if (currentForeground != IntPtr.Zero) {
        uint fgPid;
        foregroundThreadId = GetWindowThreadProcessId(currentForeground, out fgPid);
      }

      uint targetPid;
      uint targetThreadId = GetWindowThreadProcessId(hWnd, out targetPid);

      bool attachedFg = false;
      if (foregroundThreadId != 0 && foregroundThreadId != currentThreadId) {
        attachedFg = AttachThreadInput(currentThreadId, foregroundThreadId, true);
      }

      bool attachedTarget = false;
      if (targetThreadId != 0 && targetThreadId != currentThreadId && targetThreadId != foregroundThreadId) {
        attachedTarget = AttachThreadInput(currentThreadId, targetThreadId, true);
      }

      try {
        // Unlock foreground lock via virtual ALT key press
        keybd_event(VK_MENU, 0, 0, 0);
        keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0);

        if (IsIconic(hWnd)) {
          ShowWindowAsync(hWnd, SW_RESTORE);
        } else {
          ShowWindowAsync(hWnd, SW_SHOW);
        }

        BringWindowToTop(hWnd);
        bool result = SetForegroundWindow(hWnd);
        if (!result) {
          SwitchToThisWindow(hWnd, true);
          result = true;
        }
        SetFocus(hWnd);
        return result;
      } finally {
        if (attachedFg) {
          AttachThreadInput(currentThreadId, foregroundThreadId, false);
        }
        if (attachedTarget) {
          AttachThreadInput(currentThreadId, targetThreadId, false);
        }
      }
    }

    public static bool MinimizeWindow(IntPtr hWnd) {
      if (hWnd == IntPtr.Zero || !IsWindow(hWnd)) return false;
      return ShowWindowAsync(hWnd, SW_SHOWMINIMIZED);
    }

    public static bool MaximizeWindow(IntPtr hWnd) {
      if (hWnd == IntPtr.Zero || !IsWindow(hWnd)) return false;
      if (IsIconic(hWnd)) {
        ShowWindowAsync(hWnd, SW_RESTORE);
      }
      return ShowWindowAsync(hWnd, SW_SHOWMAXIMIZED);
    }

    public static bool RestoreWindow(IntPtr hWnd) {
      if (hWnd == IntPtr.Zero || !IsWindow(hWnd)) return false;
      return ShowWindowAsync(hWnd, SW_RESTORE);
    }

    public static bool CloseWindowGracefully(IntPtr hWnd) {
      if (hWnd == IntPtr.Zero || !IsWindow(hWnd)) return false;
      return PostMessage(hWnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
    }

    static WindowInfo FindCandidate(List<WindowInfo> windows, string appName, string titlePattern) {
      if (windows == null || windows.Count == 0) return null;

      string targetApp = (appName ?? "").Trim().ToLowerInvariant();
      string targetTitle = (titlePattern ?? "").Trim().ToLowerInvariant();

      // Normalize common app aliases
      if (targetApp == "vscode" || targetApp == "visual studio code") targetApp = "code";
      else if (targetApp == "visual studio") targetApp = "devenv";
      else if (targetApp == "google chrome") targetApp = "chrome";
      else if (targetApp == "microsoft edge" || targetApp == "edge") targetApp = "msedge";
      else if (targetApp == "command prompt") targetApp = "cmd";
      else if (targetApp == "powershell") targetApp = "powershell";
      else if (targetApp == "terminal" || targetApp == "windows terminal") targetApp = "windowsterminal";
      else if (targetApp == "notepad++") targetApp = "notepad++";
      else if (targetApp == "word" || targetApp == "winword") targetApp = "winword";
      else if (targetApp == "excel") targetApp = "excel";
      else if (targetApp == "powerpoint") targetApp = "powerpnt";
      else if (targetApp == "calculator" || targetApp == "calc") targetApp = "calculatorapp";
      else if (targetApp == "file explorer" || targetApp == "files") targetApp = "explorer";

      // Pass 1: exact app name + title pattern match
      if (targetApp.Length > 0 && targetTitle.Length > 0) {
        var match = windows.FirstOrDefault(w => w.App.ToLowerInvariant() == targetApp && w.Title.ToLowerInvariant().Contains(targetTitle));
        if (match != null) return match;
      }

      // Pass 2: exact app name match
      if (targetApp.Length > 0) {
        var match = windows.FirstOrDefault(w => w.App.ToLowerInvariant() == targetApp);
        if (match != null) return match;
      }

      // Pass 3: app contains targetApp
      if (targetApp.Length > 0) {
        var match = windows.FirstOrDefault(w => w.App.ToLowerInvariant().Contains(targetApp));
        if (match != null) return match;
      }

      // Pass 4: title contains targetTitle
      if (targetTitle.Length > 0) {
        var match = windows.FirstOrDefault(w => w.Title.ToLowerInvariant().Contains(targetTitle));
        if (match != null) return match;
      }

      return null;
    }

    public static List<WindowInfo> EnumerateVisibleWindows() {
      EnsureInteractiveDesktop();
      var list = new List<WindowInfo>();
      IntPtr foreground = GetForegroundWindow();
      int ownPid = Process.GetCurrentProcess().Id;

      EnumCallback callback = (handle, value) => {
        bool visible = IsWindowVisible(handle);
        bool iconic = IsIconic(handle);
        if (!visible && !iconic) return true;

        int cloaked;
        if (DwmGetWindowAttribute(handle, 14, out cloaked, 4) == 0 && cloaked != 0 && !iconic) return true;

        var text = new StringBuilder(512);
        if (GetWindowText(handle, text, text.Capacity) == 0) return true;
        uint pid;
        GetWindowThreadProcessId(handle, out pid);
        if (pid == ownPid) return true;
        string app;
        try { using (var process = Process.GetProcessById((int)pid)) app = process.ProcessName; }
        catch { return true; }
        var title = text.ToString().Trim();
        if (title.Length == 0) return true;
        if (app.Equals("explorer", StringComparison.OrdinalIgnoreCase) && title == "Program Manager") return true;

        list.Add(new WindowInfo {
          Handle = handle.ToInt64(),
          Pid = (int)pid,
          App = app,
          Title = title,
          State = iconic ? "minimized" : IsZoomed(handle) ? "maximized" : "normal",
          Active = handle == foreground,
          Document = WindowMonitor.GuessDocument(app, title)
        });
        return true;
      };

      EnumWindows(callback, IntPtr.Zero);
      return list;
    }
  }

  public class WindowActionResult {
    public bool ok { get; set; }
    public bool verified { get; set; }
    public string action { get; set; }
    public long handle { get; set; }
    public string app { get; set; }
    public string title { get; set; }
    public string error { get; set; }
  }
}
