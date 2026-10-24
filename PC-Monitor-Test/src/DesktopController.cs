using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;
using Microsoft.Win32;

namespace PcMonitorTest {
  // Only authenticated local bridge requests enter this controller. No script evaluation.
  public static class DesktopController {
    static readonly object Gate = new object();
    static readonly System.Collections.Concurrent.ConcurrentDictionary<string,DateTime> Cancelled = new System.Collections.Concurrent.ConcurrentDictionary<string,DateTime>();
    [ThreadStatic] static Dictionary<string,object> CurrentRequest;
    public static void Cancel(string id) {
      if (String.IsNullOrEmpty(id)) return;
      Cancelled[id]=DateTime.UtcNow;
      foreach (var item in Cancelled.Where(item=>item.Value<DateTime.UtcNow.AddMinutes(-5))) { DateTime ignored; Cancelled.TryRemove(item.Key,out ignored); }
    }
    static void CheckRequest() {
      if (CurrentRequest==null) return;
      long deadline;
      if (Cancelled.ContainsKey(Text(CurrentRequest,"requestId")) || (long.TryParse(Text(CurrentRequest,"deadlineUtcMs"),out deadline) && DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()>deadline)) throw new Exception("cancelled");
    }
    static readonly string Session = Guid.NewGuid().ToString("N");
    static int generation;
    static long screenshotWindow;
    static System.Windows.Rect screenshotBounds;
    sealed class ControlRef { public AutomationElement Element; public long Window; public int Generation; public int[] RuntimeId; public System.Windows.Rect Bounds; }
    static readonly Dictionary<string, ControlRef> Controls = new Dictionary<string, ControlRef>();
    [DllImport("user32.dll")] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool GetUserObjectInformation(IntPtr handle, int index, System.Text.StringBuilder name, int size, out int needed);
    [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr handle);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr handle);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(System.Drawing.Point point);
    [DllImport("user32.dll")] static extern bool IsChild(IntPtr parent,IntPtr child);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr handle,System.Text.StringBuilder name,int capacity);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr handle, out uint pid);
    [DllImport("advapi32.dll")] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll")] static extern bool GetTokenInformation(IntPtr token, int kind, out int value, int size, out int needed);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public INPUTUNION data; }
    [StructLayout(LayoutKind.Explicit)] struct INPUTUNION { [FieldOffset(0)] public MOUSE mouse; [FieldOffset(0)] public KEY key; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSE { public int x, y; public uint data, flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct KEY { public ushort vk, scan; public uint flags, time; public UIntPtr extra; }
    static string Text(Dictionary<string, object> input, string key) { object value; return input != null && input.TryGetValue(key, out value) && value != null ? value.ToString() : ""; }
    static bool Flag(Dictionary<string, object> input, string key) { object value; return input != null && input.TryGetValue(key, out value) && value is bool && (bool)value; }
    static Dictionary<string, object> Child(Dictionary<string, object> input, string key) { object value; return input != null && input.TryGetValue(key, out value) ? value as Dictionary<string, object> : null; }
    static object Result(string status, string message) { return new { status, message, verification = new { verified = false, evidence = message } }; }
    static bool Interactive() {
      IntPtr desktop = OpenInputDesktop(0, false, 1);
      if (desktop == IntPtr.Zero) return false;
      try { int needed; var name = new System.Text.StringBuilder(256); return GetUserObjectInformation(desktop, 2, name, 512, out needed) && name.ToString().Equals("Default", StringComparison.OrdinalIgnoreCase); }
      finally { CloseDesktop(desktop); }
    }
    static bool Elevated(long window) {
      uint pid; GetWindowThreadProcessId(new IntPtr(window), out pid);
      try {
        using (var process = Process.GetProcessById((int)pid)) {
          IntPtr token;
          if (!OpenProcessToken(process.Handle, 8, out token)) return true;
          try { int elevation, needed; return !GetTokenInformation(token, 20, out elevation, 4, out needed) || elevation != 0; }
          finally { CloseHandle(token); }
        }
      } catch { return true; }
    }
    static long Window(Dictionary<string, object> input,bool observing=false) {
      string target = Text(input, "target");
      if (target.StartsWith(Session + ":window:")) { long handle; var parts=target.Substring((Session + ":window:").Length).Split(':'); if (parts.Length==2 && (observing || parts[0]==generation.ToString()) && long.TryParse(parts[1],out handle) && IsWindow(new IntPtr(handle))) return handle; throw new Exception("stale_target"); }
      var windows = WindowController.EnumerateVisibleWindows();
      if (target == "" || target == "current") return GetForegroundWindow().ToInt64();
      var matches = windows.Where(w => w.App.Equals(target, StringComparison.OrdinalIgnoreCase) || w.Title.Equals(target, StringComparison.OrdinalIgnoreCase)).ToList();
      if (matches.Count == 0) matches = windows.Where(w => w.App.IndexOf(target, StringComparison.OrdinalIgnoreCase) >= 0 || w.Title.IndexOf(target, StringComparison.OrdinalIgnoreCase) >= 0).ToList();
      if (matches.Count != 1) throw new Exception(matches.Count > 1 ? "ambiguous_target" : "unavailable");
      return matches[0].Handle;
    }
    static string WindowRef(long window) { return Session + ":window:" + generation + ":" + window; }
    static object WindowInfo(WindowInfo window) { return new { @ref = WindowRef(window.Handle), app = window.App, title = window.Title, active = window.Active, state = window.State }; }
    static string Value(AutomationElement element) {
      object pattern;
      if (element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) return ((ValuePattern)pattern).Current.Value;
      if (element.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) return ((TextPattern)pattern).DocumentRange.GetText(8000);
      return element.Current.Name;
    }
    static object Observe(Dictionary<string, object> input) {
      if (!Interactive()) return Result("unsupported", "The interactive desktop is locked or secure.");
      if (Text(input, "scope") == "apps") return new { status = "ok", apps = Apps(Text(input, "query")), verification = new { verified = true, evidence = "Registered applications and Start Menu shortcuts." } };
      if (Text(input, "scope") == "windows") { generation++; Controls.Clear(); return new { status = "ok", observation = new { windows = WindowController.EnumerateVisibleWindows().Select(WindowInfo).ToArray(), generation, timestamp = DateTime.UtcNow.ToString("o") } }; }
      long window = Window(input,true);
      if (window == 0 || Elevated(window)) return Result("unsupported", "Elevated or inaccessible windows cannot be controlled.");
      var root = AutomationElement.FromHandle(new IntPtr(window));
      generation++; Controls.Clear();
      var elements = new List<object>();
      var pending = new Queue<AutomationElement>(); pending.Enqueue(root);
      int visited = 0;
      while (pending.Count > 0 && visited++ < 800 && elements.Count < 150) {
        CheckRequest();
        var element = pending.Dequeue();
        try {
          var current = element.Current;
          if (!current.IsOffscreen && !current.IsPassword && current.IsControlElement) {
            var patterns = element.GetSupportedPatterns();
            var actions = new List<string>();
            if (patterns.Contains(InvokePattern.Pattern)) actions.Add("invoke");
            if (patterns.Contains(ValuePattern.Pattern) || patterns.Contains(TextPattern.Pattern)) actions.Add("type");
            if (patterns.Contains(SelectionItemPattern.Pattern)) actions.Add("select");
            if (patterns.Contains(TogglePattern.Pattern)) actions.Add("check");
            if (patterns.Contains(ScrollPattern.Pattern)) actions.Add("scroll");
            actions.Add("click"); actions.Add("key");
            string reference = Session + ":control:" + generation + ":" + elements.Count;
            Controls[reference] = new ControlRef { Element = element, Window = window, Generation = generation, RuntimeId = element.GetRuntimeId(), Bounds = current.BoundingRectangle };
            var bounds = current.BoundingRectangle;
            elements.Add(new { @ref = reference, name = current.Name, role = current.ControlType.ProgrammaticName.Replace("ControlType.", ""), automationId = current.AutomationId,
              editable = actions.Contains("type"), enabled = current.IsEnabled, actions, value = actions.Contains("type") ? Value(element) : null,
              rect = new { x = bounds.X, y = bounds.Y, width = bounds.Width, height = bounds.Height } });
          }
          var child = TreeWalker.ControlViewWalker.GetFirstChild(element);
          for (int count=0; child != null && count++ < 200; child = TreeWalker.ControlViewWalker.GetNextSibling(child)) pending.Enqueue(child);
        } catch (ElementNotAvailableException) { }
      }
      var rectangle = AutomationElement.FromHandle(new IntPtr(window)).Current.BoundingRectangle;
      object screenshot = null;
      if (Flag(input, "screenshot")) {
        if (GetForegroundWindow().ToInt64() != window) return Result("unsupported", "Bring the window to the front before requesting its screenshot.");
        if (rectangle.Width <= 0 || rectangle.Height <= 0 || rectangle.Width > 6000 || rectangle.Height > 6000) return Result("unsupported", "Window bounds are unavailable.");
        screenshotWindow = window; screenshotBounds = rectangle;
        using (var bitmap = new Bitmap((int)rectangle.Width, (int)rectangle.Height)) {
          using (var graphics = Graphics.FromImage(bitmap)) graphics.CopyFromScreen((int)rectangle.X, (int)rectangle.Y, 0, 0, bitmap.Size);
          using (var memory = new MemoryStream()) { bitmap.Save(memory, ImageFormat.Jpeg); screenshot = new { data = Convert.ToBase64String(memory.ToArray()), mimeType = "image/jpeg", width = bitmap.Width, height = bitmap.Height }; }
        }
      }
      return new { status = "ok", observation = new { windowRef = WindowRef(window), generation, timestamp = DateTime.UtcNow.ToString("o"), controls = elements,
        rect = new { x = rectangle.X, y = rectangle.Y, width = rectangle.Width, height = rectangle.Height }, screenshot }, verification = new { verified = true, evidence = "Fresh Windows accessibility observation." } };
    }
    sealed class AppEntry { public string name; public string path; public string process; }
    static AppEntry Shortcut(string path) {
      object shell=null,shortcut=null;
      try {
        var type=Type.GetTypeFromProgID("WScript.Shell"); shell=Activator.CreateInstance(type);
        shortcut=type.InvokeMember("CreateShortcut",System.Reflection.BindingFlags.InvokeMethod,null,shell,new object[] {path});
        string target=Convert.ToString(shortcut.GetType().InvokeMember("TargetPath",System.Reflection.BindingFlags.GetProperty,null,shortcut,null));
        string arguments=Convert.ToString(shortcut.GetType().InvokeMember("Arguments",System.Reflection.BindingFlags.GetProperty,null,shortcut,null));
        target=Environment.ExpandEnvironmentVariables(target);
        // Windows' virtual Explorer shortcut has no filesystem TargetPath.
        if (String.IsNullOrWhiteSpace(target) && Path.GetFileNameWithoutExtension(path).Equals("File Explorer",StringComparison.OrdinalIgnoreCase)) target=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows),"explorer.exe");
        return new AppEntry { name=Path.GetFileNameWithoutExtension(path),path=String.IsNullOrWhiteSpace(arguments) && File.Exists(target) ? Path.GetFullPath(target) : path,process=Path.GetFileNameWithoutExtension(target) };
      } catch { return new AppEntry {name=Path.GetFileNameWithoutExtension(path),path=path,process=Path.GetFileNameWithoutExtension(path)}; }
      finally { if(shortcut!=null && Marshal.IsComObject(shortcut)) Marshal.FinalReleaseComObject(shortcut); if(shell!=null && Marshal.IsComObject(shell)) Marshal.FinalReleaseComObject(shell); }
    }
    static List<AppEntry> Apps(string query) {
      var apps = new List<AppEntry> {
        new AppEntry { name="Notepad", path=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "notepad.exe"), process="notepad" },
        new AppEntry { name="Calculator", path=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "calc.exe"), process="CalculatorApp" },
        new AppEntry { name="File Explorer", path=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe"), process="explorer" }
      };
      foreach (var hive in new [] { Registry.CurrentUser, Registry.LocalMachine }) {
        using (var root = hive.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths")) {
          if (root == null) continue;
          foreach (string name in root.GetSubKeyNames()) using (var key = root.OpenSubKey(name)) {
            var executable = Convert.ToString(key.GetValue(null)).Trim('"');
            if (File.Exists(executable)) apps.Add(new AppEntry { name=Path.GetFileNameWithoutExtension(name), path=executable, process=Path.GetFileNameWithoutExtension(name) });
          }
        }
      }
      foreach (string folder in new [] { Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), Environment.GetFolderPath(Environment.SpecialFolder.CommonStartMenu) }) {
        try { foreach (string shortcut in Directory.GetFiles(folder, "*.lnk", SearchOption.AllDirectories)) apps.Add(Shortcut(shortcut)); } catch { }
      }
      return apps.Where(a => String.IsNullOrEmpty(query) || a.name.IndexOf(query, StringComparison.OrdinalIgnoreCase) >= 0).GroupBy(a=>a.path, StringComparer.OrdinalIgnoreCase).Select(g=>g.First()).Take(100).ToList();
    }
    static object Launch(Dictionary<string, object> input) {
      string query = Text(input, "appName"), executable = Text(input, "executablePath");
      AppEntry selected;
      if (executable != "") {
        if (!Path.IsPathRooted(executable) || !File.Exists(executable) || !new [] { ".exe", ".lnk" }.Contains(Path.GetExtension(executable).ToLowerInvariant())) return Result("invalid_request", "Use an existing absolute executable or shortcut path.");
        selected = new AppEntry { name=Path.GetFileNameWithoutExtension(executable), path=executable, process=Path.GetFileNameWithoutExtension(executable) };
      } else {
        if (String.IsNullOrWhiteSpace(query)) return Result("invalid_request", "An app name is required.");
        var matches = Apps(query);
        var exact = matches.Where(a=>a.name.Equals(query, StringComparison.OrdinalIgnoreCase)).ToList();
        if (exact.Count > 0) matches = exact;
        if (matches.Count != 1) return new { status = matches.Count > 1 ? "needs_selection" : "unavailable", apps = matches, message = "Choose one exact application path." };
        selected = matches[0];
      }
      var before = new HashSet<long>(WindowController.EnumerateVisibleWindows().Select(w=>w.Handle));
      CheckRequest();
      var process = Process.Start(new ProcessStartInfo(selected.path) { UseShellExecute = true });
      int pid = process != null ? process.Id : 0;
      for (int attempt=0; attempt<40; attempt++) {
        CheckRequest();
        var matches = WindowController.EnumerateVisibleWindows().Where(w => w.Pid == pid || w.App.Equals(selected.process, StringComparison.OrdinalIgnoreCase) || w.Title.IndexOf(selected.name, StringComparison.OrdinalIgnoreCase) >= 0).ToList();
        if (selected.process.Equals("explorer",StringComparison.OrdinalIgnoreCase)) matches=matches.Where(w=> {var name=new System.Text.StringBuilder(256);GetClassName(new IntPtr(w.Handle),name,256);return name.ToString()=="CabinetWClass" || name.ToString()=="ExploreWClass";}).ToList();
        if (matches.Count > 0) {
          var fresh = matches.Where(w=>!before.Contains(w.Handle)).ToList();
          if(fresh.Count==0 && !matches.Any(w=>pid!=0 && w.Pid==pid) && attempt<5) {Thread.Sleep(200);continue;}
          var chosen = fresh.Count == 1 ? fresh[0] : matches.Count == 1 ? matches[0] : matches.FirstOrDefault(w=>w.Active);
          if (chosen == null) return new { status="needs_selection", observation = new { windows=matches.Select(WindowInfo).ToArray() } };
          var focused = WindowController.ExecuteAction("focus", chosen.Handle, null, null);
          return new { status = focused.ok ? "ok" : "partial", resolvedTarget = WindowRef(chosen.Handle), verification = new { verified = focused.ok && GetForegroundWindow().ToInt64() == chosen.Handle, evidence = "Application window found and foreground checked." } };
        }
        Thread.Sleep(200);
      }
      return Result("partial", "Application started, but its window was not identified. Inspect windows before retrying.");
    }
    static void Key(ushort vk, ushort scan, uint flags) {
      if ((flags & 2)==0) CheckRequest(); // Always release a key already pressed, including on cancellation.
      var input = new INPUT { type=1, data=new INPUTUNION { key=new KEY { vk=vk, scan=scan, flags=flags } } };
      if (SendInput(1, new [] { input }, Marshal.SizeOf(typeof(INPUT))) != 1) throw new Exception("Input was blocked.");
    }
    static void Press(ushort vk) { Key(vk, 0, 0); Key(vk, 0, 2); }
    static object Act(Dictionary<string, object> input) {
      if (!Interactive()) return Result("unsupported", "The interactive desktop is locked or secure.");
      string action = Text(input, "action");
      if (action == "launch") return Launch(input);
      long window;
      var args = Child(input, "args") ?? new Dictionary<string,object>();
      ControlRef control = null;
      string reference = Text(args, "ref");
      if (reference == "" && Text(input,"target").Contains(":control:")) reference = Text(input,"target");
      if (reference != "") {
        if (!Controls.TryGetValue(reference, out control) || control.Generation != generation) return Result("stale_target", "Observe the window again before acting.");
        window = control.Window;
        if (Text(input,"target") != "" && !Text(input,"target").Contains(":control:") && Window(input) != window) return Result("invalid_request", "The control belongs to a different window.");
      } else window = Window(input);
      if (!IsWindow(new IntPtr(window)) || Elevated(window)) return Result("unsupported", "Elevated or unavailable window.");
      if (new [] { "focus", "minimize", "maximize", "restore", "close" }.Contains(action)) {
        CheckRequest();
        var result = WindowController.ExecuteAction(action, window, null, null);
        return new { status=result.verified ? "ok" : result.ok ? "dispatched" : "failed", verification = new { verified=result.verified, evidence="Window state checked by Windows controller." } };
      }
      bool visual = action == "click" && control == null;
      if (control == null && !visual) return Result("invalid_target_type", "Use an observed control reference.");
      if (!WindowController.ExecuteAction("focus", window, null, null).ok || GetForegroundWindow().ToInt64() != window) return Result("failed", "The target window could not be focused.");
      if (control != null) {
        var current = control.Element.Current;
        if (current.IsPassword) return Result("unsupported", "Protected fields stay with the user.");
        if (current.IsOffscreen || !current.IsEnabled || !control.Element.GetRuntimeId().SequenceEqual(control.RuntimeId)) return Result("stale_target", "The observed control is no longer actionable.");
      }
      bool verified = false;
      CheckRequest();
      var requestedExpectation=Child(input,"expect");
      if (requestedExpectation!=null) {
        string expectedKind=Text(requestedExpectation,"kind");
        ControlRef expectedControl;
        if (!new [] {"value","text","checked","visible","window_title"}.Contains(expectedKind)) return Result("invalid_request","Unsupported expectation.");
        if (expectedKind!="window_title" && (!Controls.TryGetValue(Text(requestedExpectation,"ref"),out expectedControl) || expectedControl.Window!=window || expectedControl.Generation!=generation)) return Result("invalid_request","Expectation must use an observed control in this window.");
      }
      object pattern;
      if (action == "type") {
        string text = Text(args,"text"); if (text.Length > 8000) return Result("invalid_request", "Text is too long.");
        if (control.Element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern) && !((ValuePattern)pattern).Current.IsReadOnly) ((ValuePattern)pattern).SetValue(text);
        else {
          control.Element.SetFocus();
          if (GetForegroundWindow().ToInt64() != window || !AutomationElement.FocusedElement.GetRuntimeId().SequenceEqual(control.RuntimeId)) return Result("failed", "Input focus changed.");
          if (Flag(args,"replace")) { Key(0x11,0,0); try { Press(0x41); } finally { Key(0x11,0,2); } }
          foreach (char character in text) { if(GetForegroundWindow().ToInt64()!=window) return Result("partial","Input focus changed during entry. Inspect the value before continuing."); Key(0,character,4); Key(0,character,6); }
        }
        verified = Value(control.Element).TrimEnd('\r','\n') == text;
      } else if ((action == "invoke" || action=="click" && control!=null && !args.ContainsKey("x") && !args.ContainsKey("y")) && control.Element.TryGetCurrentPattern(InvokePattern.Pattern, out pattern)) ((InvokePattern)pattern).Invoke();
      else if (action == "select" && control.Element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern)) { ((SelectionItemPattern)pattern).Select(); verified=((SelectionItemPattern)pattern).Current.IsSelected; }
      else if (action == "check" && control.Element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)) {
        var toggle=(TogglePattern)pattern; var desired=Flag(args,"enabled") ? ToggleState.On : ToggleState.Off;
        if (toggle.Current.ToggleState != desired) toggle.Toggle(); verified=toggle.Current.ToggleState == desired;
      } else if (action == "scroll" && control.Element.TryGetCurrentPattern(ScrollPattern.Pattern, out pattern)) {
        var scroll=(ScrollPattern)pattern; double before=scroll.Current.VerticalScrollPercent;
        scroll.Scroll(ScrollAmount.NoAmount, Text(args,"direction")=="up" ? ScrollAmount.LargeDecrement : ScrollAmount.LargeIncrement); verified=scroll.Current.VerticalScrollPercent != before;
      } else if (action == "key") {
        var keys=new Dictionary<string,ushort> { {"Enter",13},{"Tab",9},{"Escape",27},{"Backspace",8},{"Delete",46},{"ArrowLeft",37},{"ArrowUp",38},{"ArrowRight",39},{"ArrowDown",40},{"Space",32} };
        ushort vk; if (!keys.TryGetValue(Text(args,"key"),out vk)) return Result("invalid_request","Unsupported key.");
        control.Element.SetFocus();
        if (GetForegroundWindow().ToInt64()!=window || !AutomationElement.FocusedElement.GetRuntimeId().SequenceEqual(control.RuntimeId)) return Result("failed","Input focus changed.");
        Press(vk);
      } else if (action == "click") {
        var rect=control != null ? control.Element.Current.BoundingRectangle : AutomationElement.FromHandle(new IntPtr(window)).Current.BoundingRectangle;
        if (visual && (Text(args,"generation") != generation.ToString() || screenshotWindow != window || screenshotBounds != rect)) return Result("stale_target","Use a fresh screenshot of this window and its current geometry.");
        double x=rect.Width/2, y=rect.Height/2;
        if (args.ContainsKey("x") || args.ContainsKey("y")) { if (!double.TryParse(Text(args,"x"),out x) || !double.TryParse(Text(args,"y"),out y) || x<0 || y<0 || x>=rect.Width || y>=rect.Height) return Result("invalid_request","Offsets must lie inside observed bounds."); }
        if (control != null && control.Bounds != rect) return Result("stale_target","Control geometry changed. Observe again.");
        var hit=WindowFromPoint(new System.Drawing.Point((int)(rect.X+x),(int)(rect.Y+y)));
        if (hit.ToInt64()!=window && !IsChild(new IntPtr(window),hit)) return Result("unsupported","Another window covers the requested click point.");
        CheckRequest();
        if (!SetCursorPos((int)(rect.X+x),(int)(rect.Y+y))) return Result("failed","Cursor positioning failed.");
        var down=new INPUT { type=0,data=new INPUTUNION { mouse=new MOUSE { flags=2 } } }; var up=new INPUT { type=0,data=new INPUTUNION { mouse=new MOUSE { flags=4 } } };
        if (SendInput(2,new [] { down,up },Marshal.SizeOf(typeof(INPUT)))!=2) return Result("failed","Click was blocked.");
      } else return Result("unsupported","This control does not support the requested action.");
      var expect=Child(input,"expect");
      if (expect != null) {
        var deadline=DateTime.UtcNow.AddSeconds(3);
        do {
          try {
            string kind=Text(expect,"kind"), desired=Text(expect,"value");
            if (kind=="window_title") verified=AutomationElement.FromHandle(new IntPtr(window)).Current.Name.Contains(desired);
            else {
              ControlRef expected; if (!Controls.TryGetValue(Text(expect,"ref"),out expected) || expected.Window!=window) return Result("invalid_request","Expectation must use a control in this window.");
              if (kind=="value") verified=Value(expected.Element).TrimEnd('\r','\n')==desired;
              else if (kind=="text") verified=Value(expected.Element).Contains(desired);
              else if (kind=="checked" && expected.Element.TryGetCurrentPattern(TogglePattern.Pattern,out pattern)) verified=(((TogglePattern)pattern).Current.ToggleState==ToggleState.On)==(desired=="true");
              else if (kind=="visible") verified=!expected.Element.Current.IsOffscreen;
              else return Result("invalid_request","Unsupported expectation.");
            }
          } catch (ElementNotAvailableException) { verified=false; }
        if (verified) break; Thread.Sleep(100);
          CheckRequest();
        } while (DateTime.UtcNow<deadline);
      }
      return new { status=verified ? "ok" : "dispatched", resolvedTarget=WindowRef(window), verification=new { verified, evidence=verified ? "Requested state observed after action." : "Input sent; intended outcome has not been verified." } };
    }
    public static object Execute(bool observe, Dictionary<string, object> input) {
      lock (Gate) {
        CurrentRequest=input;
        SetProcessDPIAware();
        try { CheckRequest(); return observe ? Observe(input) : Act(input); }
        catch (ElementNotAvailableException) { return Result("stale_target","The control disappeared. Observe again."); }
        catch (Exception error) { return Result(new [] {"stale_target","ambiguous_target","unavailable","cancelled"}.Contains(error.Message) ? error.Message : "failed", error.Message); }
        finally { CurrentRequest=null; }
      }
    }
  }
}
