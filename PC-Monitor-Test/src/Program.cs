using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Threading;

namespace PcMonitorTest {
  static class Program {
    static volatile bool quitting;
    static int Main(string[] args) {
      bool once = args.Any(a => a == "--once");
      bool quiet = args.Any(a => a == "--quiet");
      int measureSeconds = 0;
      foreach (var argument in args.Where(a => a.StartsWith("--measure-seconds=")))
        Int32.TryParse(argument.Substring("--measure-seconds=".Length), out measureSeconds);
      if (measureSeconds < 0 || measureSeconds > 86400) { Console.Error.WriteLine("Measurement must be between 0 and 86400 seconds."); return 2; }
      // Electron starts the quiet monitor without console handles.
      try { Console.OutputEncoding = System.Text.Encoding.UTF8; }
      catch (System.IO.IOException) { /* No console is attached in quiet desktop mode. */ }
      Console.CancelKeyPress += (sender, eventArgs) => { eventArgs.Cancel = true; quitting = true; };

      string actionArg = args.FirstOrDefault(a => a.StartsWith("--action="));
      if (!String.IsNullOrEmpty(actionArg)) {
        string action = actionArg.Substring("--action=".Length);
        long handle = 0;
        string handleArg = args.FirstOrDefault(a => a.StartsWith("--handle="));
        if (!String.IsNullOrEmpty(handleArg)) Int64.TryParse(handleArg.Substring("--handle=".Length), out handle);
        string appArg = args.FirstOrDefault(a => a.StartsWith("--app="));
        string app = !String.IsNullOrEmpty(appArg) ? appArg.Substring("--app=".Length) : null;
        string titleArg = args.FirstOrDefault(a => a.StartsWith("--title="));
        string title = !String.IsNullOrEmpty(titleArg) ? titleArg.Substring("--title=".Length) : null;

        var result = WindowController.ExecuteAction(action, handle, app, title);
        var serializer = new System.Web.Script.Serialization.JavaScriptSerializer();
        Console.WriteLine(serializer.Serialize(result));
        return result.ok ? 0 : 1;
      }

      bool createdNew = true;
      Mutex singleInstance = null;
      if (!once) {
        try {
          singleInstance = new Mutex(true, "Local\\OrvixPcMonitorInstanceMutex", out createdNew);
          if (!createdNew) {
            if (!quiet) Console.WriteLine("PC Monitor is already running in the background.");
            singleInstance.Dispose();
            return 0;
          }
        } catch {
          // Mutex could not be created or accessed; proceed normally
        }
      }

      try {
        var history = new HistoryStore();
        var state = new StateStore(history);
        var userActivity = new UserActivityMonitor(idleThresholdSec: 60);
        using (var system = new SystemMonitor(history.Root))
        using (var windows = new WindowMonitor())
        using (var browser = new BrowserServer(state, history.Token)) {
          windows.Start(); browser.Start();
          var dashboard = new Dashboard(history.Token, history.HistoryDirectory, browser.Error);
          var clock = Stopwatch.StartNew();
          var lastTick = TimeSpan.Zero;
          var nextWindows = TimeSpan.Zero;
          var nextAudio = TimeSpan.Zero;
          var nextBrightness = TimeSpan.Zero;
          var nextPower = TimeSpan.Zero;
          var nextMedia = TimeSpan.Zero;
          var nextActivitySync = TimeSpan.Zero;
          var nextHistory = TimeSpan.Zero;
          var lastSnapshot = TimeSpan.MinValue;
          long lastSignalSequence = 0, lastSignalDropped = 0;
          var process = Process.GetCurrentProcess();
          var startingCpu = process.TotalProcessorTime;
          long maxPrivate = 0;
          bool rendered = false;
          var lastRender = TimeSpan.MinValue;
          List<WindowInfo> currentWindows = null;
          while (!quitting) {
            var now = clock.Elapsed;
            double deltaSeconds = (now - lastTick).TotalSeconds;
            lastTick = now;
            bool windowEventOccurred = windows.ConsumeDirty();
            if (windowEventOccurred || now >= nextWindows) {
              currentWindows = windows.Capture();
              state.SetWindows(currentWindows);
              nextWindows = now.Add(TimeSpan.FromSeconds(10));
            }
            string activeApp = null;
            if (currentWindows != null) {
              var activeWin = currentWindows.FirstOrDefault(w => w.Active);
              if (activeWin != null) activeApp = activeWin.App;
            }
            List<string> activityEvents;
            userActivity.Update(activeApp, deltaSeconds, out activityEvents);

            bool routineSync = now >= nextActivitySync;
            if (windowEventOccurred || activityEvents.Count > 0 || routineSync) {
              state.SetActivity(userActivity.GetSnapshot(activeApp), activityEvents);
              if (routineSync) nextActivitySync = now.Add(TimeSpan.FromMilliseconds(500));
            }
            bool systemChanged = false;
            if (system.ConsumeAudioDirty() || now >= nextAudio) { system.RefreshAudio(); nextAudio = now.Add(TimeSpan.FromMilliseconds(500)); systemChanged = true; }
            if (system.ConsumeBrightnessDirty() || now >= nextBrightness) { system.RefreshBrightness(); nextBrightness = now.Add(TimeSpan.FromSeconds(2)); systemChanged = true; }
            if (now >= nextPower) { system.RefreshPower(); state.SetPower(system.BatteryPercent, system.OnAcPower, system.Charging); nextPower = now.Add(TimeSpan.FromMilliseconds(500)); }
            if (now >= nextMedia) { system.RefreshMedia(); nextMedia = now.Add(TimeSpan.FromSeconds(1)); systemChanged = true; }
            if (systemChanged) state.SetSystem(system.Volume, system.Muted, system.Brightness, system.Media, system.SignalSources);
            if (now >= nextHistory) { history.Flush(); nextHistory = now.Add(TimeSpan.FromSeconds(1)); }
            bool changed;
            var snapshot = state.Read(out changed);
            snapshot.SignalEvents = system.Events.Read();
            snapshot.SignalPollMonotonicMs = new Dictionary<string, double>(system.SignalPollMonotonicMs);
            snapshot.VolumePrecise = system.VolumePrecise;
            changed |= snapshot.SignalEvents.LastSequence != lastSignalSequence || snapshot.SignalEvents.Dropped != lastSignalDropped;
            lastSignalSequence = snapshot.SignalEvents.LastSequence; lastSignalDropped = snapshot.SignalEvents.Dropped;
            // Heartbeat freshness without rewriting 10 times per second in quiet mode.
            if (changed || lastSnapshot == TimeSpan.MinValue || now - lastSnapshot >= TimeSpan.FromSeconds(1)) {
              history.SaveCurrentState(snapshot); lastSnapshot = now;
            }
            if (once) { dashboard.Render(snapshot); break; }
            if (!quiet && (changed || !rendered || now - lastRender >= TimeSpan.FromSeconds(30))) {
              dashboard.Render(snapshot); rendered = true; lastRender = now;
            }
            if (!quiet && !Console.IsInputRedirected) {
              try {
                if (Console.KeyAvailable) {
                  char key = Char.ToUpperInvariant(Console.ReadKey(true).KeyChar);
                  if (key == 'Q') quitting = true;
                  else if (key == 'P') { dashboard.ShowToken = !dashboard.ShowToken; dashboard.Render(snapshot); }
                  else if (key == 'D' || key == 'W' || key == 'T' || key == 'H' || key == 'A') { dashboard.Mode = key; dashboard.Render(snapshot); }
                }
              } catch (InvalidOperationException) { /* Terminal input is unavailable. */ }
            }
            process.Refresh();
            maxPrivate = Math.Max(maxPrivate, process.PrivateMemorySize64);
            if (measureSeconds > 0 && now.TotalSeconds >= measureSeconds) break;
            // Window changes still wake this loop immediately; idle sensor upkeep only needs 4 Hz.
            windows.EventSignal.WaitOne(250);
          }
          history.Flush();
          if (measureSeconds > 0) {
            process.Refresh();
            double seconds = Math.Max(1, clock.Elapsed.TotalSeconds);
            double cpuPercent = (process.TotalProcessorTime - startingCpu).TotalSeconds / seconds / Environment.ProcessorCount * 100;
            Console.WriteLine("MEASUREMENT seconds=" + seconds.ToString("F1", CultureInfo.InvariantCulture) +
              " averageCpuPercent=" + cpuPercent.ToString("F3", CultureInfo.InvariantCulture) +
              " peakPrivateMB=" + (maxPrivate / 1048576.0).ToString("F1", CultureInfo.InvariantCulture) +
              " finalPrivateMB=" + (process.PrivateMemorySize64 / 1048576.0).ToString("F1", CultureInfo.InvariantCulture));
          }
        }
        return 0;
      } catch (Exception error) {
        Console.Error.WriteLine("PC Monitor stopped: " + error.Message);
        return 1;
      } finally {
        if (singleInstance != null) {
          try { singleInstance.ReleaseMutex(); } catch {}
          singleInstance.Dispose();
        }
      }
    }
  }
}
