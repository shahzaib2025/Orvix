using System;
using System.Linq;

namespace PcMonitorTest {
  public sealed class Dashboard {
    public char Mode = 'D';
    public bool ShowToken;
    readonly string token;
    readonly string historyPath;
    readonly string serverError;
    public Dashboard(string pairingToken, string historyDirectory, string listenerError) {
      token = pairingToken; historyPath = historyDirectory; serverError = listenerError;
    }
    static string Fit(string text, int width) {
      text = (text ?? "").Replace('\r', ' ').Replace('\n', ' ');
      if (width < 8) width = 8;
      return text.Length <= width ? text : text.Substring(0, width - 1) + "…";
    }
    static void Line(string text) {
      int width = 110;
      try { width = Math.Max(40, Console.WindowWidth - 1); } catch { }
      Console.WriteLine(Fit(text, width));
    }
    public void Render(Snapshot data) {
      try { Console.Clear(); } catch { }
      Line("PC MONITOR TEST  |  Local Windows activity  |  " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));
      Line("D dashboard  W all windows  T all tabs  A focus & dwell  H recent events  P pairing  Q quit");
      Line(new string('─', 75));
      if (!String.IsNullOrEmpty(serverError)) Line("Browser listener unavailable: " + serverError);
      if (ShowToken) {
        Line("Pairing token (enter once in the extension popup): " + token);
        Line("The extension sends only to 127.0.0.1:49491. Press P to hide the token.");
        Line(new string('─', 75));
      }
      if (Mode == 'W') { Windows(data, true); return; }
      if (Mode == 'T') { Browsers(data, true); return; }
      if (Mode == 'A') { DwellDistribution(data); return; }
      if (Mode == 'H') { History(data); return; }
      var active = data.Windows.FirstOrDefault(w => w.Active);
      Line("ACTIVE  " + (active == null ? "Unknown" : active.App + " | " + active.Title));
      var act = data.Activity;
      if (act != null) {
        string statusStr = act.IsIdle 
          ? "[IDLE / AFK for " + UserActivityMonitor.FormatDuration(act.IdleSeconds) + "] (dwell paused)"
          : "Active (idle: " + act.IdleSeconds + "s)";
        string modeStr = act.NotificationState ?? "Normal";
        string ratioStr = "Session: " + UserActivityMonitor.FormatDuration(act.TotalActiveSeconds) + " active, " + UserActivityMonitor.FormatDuration(act.TotalIdleSeconds) + " idle";
        Line("USER    " + statusStr + "  |  Mode: " + modeStr + "  |  " + ratioStr);
        if (act.DwellTimes != null && act.DwellTimes.Count > 0) {
          var topApps = act.DwellTimes.Take(3).Select(d => d.App + " " + d.FormattedTime + " (" + d.Percent.ToString("F0") + "%)");
          Line("FOCUS   " + String.Join(" | ", topApps.ToArray()) + (act.DwellTimes.Count > 3 ? "  … press A for all" : ""));
        }
      }
      Line("SYSTEM  Volume: " + (data.Volume.HasValue ? data.Volume + "%" + (data.Muted == true ? " muted" : "") : "unavailable") +
        "  Brightness: " + (data.Brightness.HasValue ? data.Brightness + "%" : "unavailable"));
      Line("");
      Windows(data, false);
      Line("");
      Browsers(data, false);
      Line("");
      Media(data);
      Line("");
      History(data);
    }
    void Windows(Snapshot data, bool full) {
      var items = data.Windows.OrderByDescending(w => w.Active).ThenBy(w => w.App).ToList();
      Line("WINDOWS  " + items.Count + " top-level | Chrome " + items.Count(w => w.App.Equals("chrome", StringComparison.OrdinalIgnoreCase)) +
        " | Edge " + items.Count(w => w.App.Equals("msedge", StringComparison.OrdinalIgnoreCase)));
      foreach (var item in items.Take(full ? 100 : 8))
        Line((item.Active ? "> " : "  ") + item.State.PadRight(10) + item.App.PadRight(18) + item.Title +
          (full ? "  [file: " + item.Document + "]" : ""));
      if (!full && items.Count > 8) Line("  … press W for all windows");
    }
    void Browsers(Snapshot data, bool full) {
      Line("BROWSER TABS  Chrome and Edge (extension required)");
      foreach (var name in new[] { "Chrome", "Edge" }) {
        var browser = data.Browsers.FirstOrDefault(b => b.Name == name);
        if (browser == null) { Line("  " + name + ": extension not connected"); continue; }
        bool stale = (DateTime.UtcNow - browser.SeenUtc).TotalSeconds > 90;
        Line("  " + name + ": " + browser.Tabs.Select(t => t.windowId).Distinct().Count() + " browser windows | " +
          browser.Tabs.Count + " tabs | " + (stale ? "disconnected / last snapshot retained" : "connected"));
        foreach (var tab in browser.Tabs.OrderByDescending(t => t.active).Take(full ? 200 : 3))
          Line("    " + (tab.active ? "> " : "  ") + (tab.audible ? "♫ " : "  ") + (tab.title ?? "Untitled") + "  " + (tab.url ?? ""));
        if (!full && browser.Tabs.Count > 3) Line("    … press T for all tabs");
      }
    }
    void Media(Snapshot data) {
      Line("PLAYING MEDIA");
      if (data.Media.Count == 0) Line("  No Windows media session reporting playback");
      foreach (var item in data.Media) Line("  " + item.Source + " | " + item.Title + (String.IsNullOrEmpty(item.Artist) ? "" : " — " + item.Artist));
      foreach (var browser in data.Browsers)
        foreach (var video in browser.Videos.Where(v => v.playing).Take(10))
          Line("  " + browser.Name + " video | " + (video.title ?? "Page title unavailable") + (video.muted ? " [muted]" : ""));
    }
    void DwellDistribution(Snapshot data) {
      Line("APP FOCUS & DWELL TIME DISTRIBUTION  (Real active time; pauses when Idle / Away)");
      var act = data.Activity;
      if (act == null || act.DwellTimes == null || act.DwellTimes.Count == 0) {
        Line("  No application dwell time accumulated yet. Waiting for window activity…");
        return;
      }
      double totalTracked = act.TotalActiveSeconds + act.TotalIdleSeconds;
      double activeRatio = totalTracked > 0 ? (act.TotalActiveSeconds / totalTracked) * 100.0 : 0;
      Line("  Session Active: " + UserActivityMonitor.FormatDuration(act.TotalActiveSeconds) + 
           " (" + activeRatio.ToString("F1") + "%)  |  Idle/Away: " + UserActivityMonitor.FormatDuration(act.TotalIdleSeconds) + 
           "  |  State: " + (act.IsIdle ? "IDLE/AFK" : "ACTIVE") + " [" + act.NotificationState + "]");
      Line(new string('─', 75));
      Line("   APP NAME              ACTIVE TIME    SHARE   VISUAL BREAKDOWN");
      Line(new string('─', 75));

      foreach (var item in act.DwellTimes.Take(25)) {
        string marker = item.IsCurrent ? "> " : "  ";
        string app = item.App.PadRight(20);
        string time = item.FormattedTime.PadRight(14);
        string pct = (item.Percent.ToString("F1") + "%").PadLeft(6);
        string bar = RenderBar(item.Percent, 20);
        Line(marker + app + time + pct + "  " + bar);
      }
      if (act.DwellTimes.Count > 25) {
        Line("  … " + (act.DwellTimes.Count - 25) + " more applications with dwell time");
      }
    }
    static string RenderBar(double percent, int width) {
      int filled = (int)Math.Max(0, Math.Min(width, Math.Round((percent / 100.0) * width)));
      return "[" + new string('█', filled) + new string('░', width - filled) + "]";
    }
    void History(Snapshot data) {
      Line("RECENT CHANGES  (7-day local history: " + historyPath + ")");
      foreach (var item in data.Recent.AsEnumerable().Reverse().Take(Mode == 'H' ? 12 : 5))
        Line("  " + item.utc.ToLocalTime().ToString("HH:mm:ss") + "  " + item.source + " / " + item.action + "  " + item.detail);
      if (data.Recent.Count == 0) Line("  Waiting for activity…");
    }
  }
}
