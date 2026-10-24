using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace PcMonitorTest {
  public sealed class WindowMonitor : IDisposable {
    delegate bool EnumCallback(IntPtr handle, IntPtr value);
    delegate void WinEventCallback(IntPtr hook, uint eventType, IntPtr handle, int objectId, int childId, uint threadId, uint time);
    [StructLayout(LayoutKind.Sequential)] struct NativeMessage { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumCallback callback, IntPtr value);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr handle);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr handle);
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr handle);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr handle, StringBuilder text, int max);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr handle, int attribute, out int value, int size);
    [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint first, uint last, IntPtr module, WinEventCallback callback, uint process, uint thread, uint flags);
    [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
    [DllImport("user32.dll")] static extern int GetMessage(out NativeMessage message, IntPtr handle, uint min, uint max);
    [DllImport("user32.dll")] static extern bool PostThreadMessage(uint threadId, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    public readonly AutoResetEvent EventSignal = new AutoResetEvent(false);
    readonly List<IntPtr> hooks = new List<IntPtr>();
    readonly WinEventCallback eventCallback;
    Thread hookThread;
    uint hookThreadId;
    int changed = 1;
    volatile bool stopping;
    public WindowMonitor() { eventCallback = OnEvent; }
    void OnEvent(IntPtr hook, uint eventType, IntPtr handle, int objectId, int childId, uint threadId, uint time) {
      if (objectId == 0) {
        Interlocked.Exchange(ref changed, 1);
        try { EventSignal.Set(); } catch { }
      }
    }
    void AddHook(uint id) { var hook = SetWinEventHook(id, id, IntPtr.Zero, eventCallback, 0, 0, 0x0000 | 0x0002); if (hook != IntPtr.Zero) hooks.Add(hook); }
    void Listen() {
      WindowController.EnsureInteractiveDesktop();
      hookThreadId = GetCurrentThreadId();
      foreach (uint id in new uint[] { 0x0003, 0x0016, 0x0017, 0x8000, 0x8001, 0x8002, 0x8003, 0x800A, 0x800C }) AddHook(id);
      NativeMessage message;
      while (!stopping && GetMessage(out message, IntPtr.Zero, 0, 0) > 0) { }
      foreach (var hook in hooks) UnhookWinEvent(hook);
      hooks.Clear();
    }
    public void Start() { hookThread = new Thread(Listen) { IsBackground = true, Name = "Window events" }; hookThread.Start(); }
    public bool ConsumeDirty() { return Interlocked.Exchange(ref changed, 0) != 0; }
    public List<WindowInfo> Capture() {
      WindowController.EnsureInteractiveDesktop();
      var list = new List<WindowInfo>();
      var foreground = GetForegroundWindow();
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
        list.Add(new WindowInfo { Handle = handle.ToInt64(), Pid = (int)pid, App = app,
          Title = title, State = iconic ? "minimized" : IsZoomed(handle) ? "maximized" : "normal",
          Active = handle == foreground, Document = GuessDocument(app, title) });
        return true;
      };
      EnumWindows(callback, IntPtr.Zero);
      return list;
    }
    public static string GuessDocument(string app, string title) {
      if (String.IsNullOrEmpty(title)) return "None";
      string cleanTitle = title.TrimStart('●', ' ', '*', '•').Trim();

      // Antigravity IDE: "Orvix-Project-v2 - Antigravity IDE - WindowController.cs"
      if (cleanTitle.IndexOf("Antigravity", StringComparison.OrdinalIgnoreCase) >= 0) {
        var parts = cleanTitle.Split(new[] { " - " }, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length >= 3) {
          return String.Format("{0} (in {1})", parts[parts.Length - 1].Trim(), parts[0].Trim());
        } else if (parts.Length == 2) {
          int agIndex = parts[0].IndexOf("Antigravity", StringComparison.OrdinalIgnoreCase) >= 0 ? 0 : 1;
          int otherIndex = agIndex == 0 ? 1 : 0;
          return parts[otherIndex].Trim();
        }
      }

      // Visual Studio Code / Cursor / Windsurf / Editors
      string[] ideSuffixes = {
        " - Visual Studio Code", " - Visual Studio", " - Cursor",
        " - Windsurf", " - Sublime Text", " - Notepad++", " - Notepad"
      };
      foreach (var suffix in ideSuffixes) {
        if (cleanTitle.EndsWith(suffix, StringComparison.OrdinalIgnoreCase)) {
          var val = cleanTitle.Substring(0, cleanTitle.Length - suffix.Length).Trim();
          var parts = val.Split(new[] { " - " }, StringSplitOptions.RemoveEmptyEntries);
          if (parts.Length >= 2) {
            return String.Format("{0} (in {1})", parts[0].Trim(), parts[parts.Length - 1].Trim());
          }
          return val.Length > 0 ? val : "Active document";
        }
      }

      // Office Apps
      string[] officeSuffixes = { " - Word", " - Excel", " - PowerPoint", " - Paint" };
      foreach (var suffix in officeSuffixes) {
        if (cleanTitle.EndsWith(suffix, StringComparison.OrdinalIgnoreCase)) {
          return cleanTitle.Substring(0, cleanTitle.Length - suffix.Length).Trim();
        }
      }

      // Browsers: Chrome / Edge
      if (app.Equals("chrome", StringComparison.OrdinalIgnoreCase) || app.Equals("msedge", StringComparison.OrdinalIgnoreCase)) {
        string clean = cleanTitle;
        if (clean.EndsWith(" - Google Chrome", StringComparison.OrdinalIgnoreCase)) clean = clean.Substring(0, clean.Length - " - Google Chrome".Length).Trim();
        else if (clean.EndsWith(" - Microsoft Edge", StringComparison.OrdinalIgnoreCase)) clean = clean.Substring(0, clean.Length - " - Microsoft Edge".Length).Trim();
        return clean.Length > 0 ? "Web: " + clean : "Browser Tab";
      }

      if (app.Equals("explorer", StringComparison.OrdinalIgnoreCase)) return "Folder: " + title;
      return cleanTitle;
    }
    public void Dispose() { stopping = true; if (hookThreadId != 0) PostThreadMessage(hookThreadId, 0x0012, IntPtr.Zero, IntPtr.Zero); if (hookThread != null) hookThread.Join(1000); try { EventSignal.Close(); } catch { } }
  }
}
