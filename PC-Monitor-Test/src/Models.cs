using System;
using System.Collections.Generic;
using System.Linq;

namespace PcMonitorTest {
  public sealed class WindowInfo {
    public long Handle { get; set; }
    public int Pid { get; set; }
    public string App { get; set; }
    public string Title { get; set; }
    public string State { get; set; }
    public string Document { get; set; }
    public bool Active { get; set; }
  }
  public sealed class BrowserTab {
    public int id { get; set; }
    public int windowId { get; set; }
    public string title { get; set; }
    public string url { get; set; }
    public bool active { get; set; }
    public bool audible { get; set; }
    public bool muted { get; set; }
  }
  public sealed class VideoState {
    public int tabId { get; set; }
    public string title { get; set; }
    public bool playing { get; set; }
    public bool muted { get; set; }
  }
  public sealed class BrowserReport {
    public string browser { get; set; }
    public BrowserTab[] tabs { get; set; }
    public VideoState[] videos { get; set; }
  }
  public sealed class BrowserSnapshot {
    public string Name { get; set; }
    public DateTime SeenUtc { get; set; }
    public List<BrowserTab> Tabs { get; set; }
    public List<VideoState> Videos { get; set; }
  }
  public sealed class MediaInfo {
    public string Source { get; set; }
    public string Title { get; set; }
    public string Artist { get; set; }
  }
  public sealed class ActivityRecord {
    public DateTime utc { get; set; }
    public string source { get; set; }
    public string action { get; set; }
    public string detail { get; set; }
  }
  public sealed class AppDwellInfo {
    public string App { get; set; }
    public double ActiveSeconds { get; set; }
    public double Percent { get; set; }
    public string FormattedTime { get; set; }
    public bool IsCurrent { get; set; }
  }
  public sealed class UserActivitySnapshot {
    public int IdleSeconds { get; set; }
    public bool IsIdle { get; set; }
    public string NotificationState { get; set; }
    public bool IsPresentationOrFullscreen { get; set; }
    public double TotalActiveSeconds { get; set; }
    public double TotalIdleSeconds { get; set; }
    public List<AppDwellInfo> DwellTimes { get; set; }
  }
  public sealed class Snapshot {
    public SignalEventBatch SignalEvents { get; set; }
    public Dictionary<string, double> SignalPollMonotonicMs { get; set; }
    public double? VolumePrecise { get; set; }
    public Dictionary<string, string> SignalSources { get; set; }
    public List<WindowInfo> Windows { get; set; }
    public List<BrowserSnapshot> Browsers { get; set; }
    public List<MediaInfo> Media { get; set; }
    public int? Volume { get; set; }
    public bool? Muted { get; set; }
    public int? Brightness { get; set; }
    public int? BatteryPercent { get; set; }
    public bool? OnAcPower { get; set; }
    public bool? Charging { get; set; }
    public UserActivitySnapshot Activity { get; set; }
    public List<ActivityRecord> Recent { get; set; }
  }
  public sealed class StateStore {
    readonly object gate = new object();
    readonly HistoryStore history;
    List<WindowInfo> windows = new List<WindowInfo>();
    readonly Dictionary<string, BrowserSnapshot> browsers = new Dictionary<string, BrowserSnapshot>(StringComparer.OrdinalIgnoreCase);
    List<MediaInfo> media = new List<MediaInfo>();
    Dictionary<string, string> signalSources = new Dictionary<string, string>();
    int? volume, brightness, batteryPercent;
    bool? muted, onAcPower, charging;
    UserActivitySnapshot activity = new UserActivitySnapshot { DwellTimes = new List<AppDwellInfo>() };
    readonly List<ActivityRecord> recent = new List<ActivityRecord>();
    bool dirty = true;
    public StateStore(HistoryStore historyStore) { history = historyStore; }
    void Add(string source, string action, string detail) {
      var record = new ActivityRecord { utc = DateTime.UtcNow, source = source, action = action, detail = detail };
      recent.Add(record);
      if (recent.Count > 12) recent.RemoveAt(0);
      history.Enqueue(record);
      dirty = true;
    }
    static string SafeUrl(string value) {
      Uri uri;
      if (!Uri.TryCreate(value ?? "", UriKind.Absolute, out uri)) return value ?? "";
      return uri.GetLeftPart(UriPartial.Path);
    }
    public void SetWindows(List<WindowInfo> next) {
      lock (gate) {
        var priorSignature = String.Join("|", windows.OrderBy(w => w.Handle).Select(w => w.Handle + ":" + w.State + ":" + w.Title + ":" + w.Active));
        var nextSignature = String.Join("|", next.OrderBy(w => w.Handle).Select(w => w.Handle + ":" + w.State + ":" + w.Title + ":" + w.Active));
        var oldActive = windows.FirstOrDefault(w => w.Active);
        var newActive = next.FirstOrDefault(w => w.Active);
        if ((oldActive == null ? 0 : oldActive.Handle) != (newActive == null ? 0 : newActive.Handle))
          Add("windows", "foreground", newActive == null ? "Unknown window" : newActive.App + " | " + newActive.Title);
        var oldStates = windows.ToDictionary(w => w.Handle, w => w.State);
        foreach (var item in next) {
          string old;
          if (oldStates.TryGetValue(item.Handle, out old) && old != item.State)
            Add("windows", "state", item.App + " | " + item.Title + " -> " + item.State);
        }
        if (next.Count != windows.Count) Add("windows", "count", next.Count + " visible windows");
        windows = next;
        if (priorSignature != nextSignature) dirty = true;
      }
    }
    public void SetBrowser(BrowserReport report) {
      if (report == null || (report.browser != "Chrome" && report.browser != "Edge")) return;
      lock (gate) {
        BrowserSnapshot previous;
        browsers.TryGetValue(report.browser, out previous);
        var tabs = (report.tabs ?? new BrowserTab[0]).Where(t => t != null).Take(1000).ToList();
        var videos = (report.videos ?? new VideoState[0]).Where(v => v != null).Take(1000).ToList();
        var oldSignature = previous == null ? "" : String.Join("|", previous.Tabs.Select(t => t.id + ":" + t.title + ":" + t.url + ":" + t.active + ":" + t.audible)) +
          String.Join("|", previous.Videos.Select(v => v.tabId + ":" + v.playing + ":" + v.title));
        var newSignature = String.Join("|", tabs.Select(t => t.id + ":" + t.title + ":" + t.url + ":" + t.active + ":" + t.audible)) +
          String.Join("|", videos.Select(v => v.tabId + ":" + v.playing + ":" + v.title));
        var active = tabs.FirstOrDefault(t => t.active);
        var prior = previous == null ? null : previous.Tabs.FirstOrDefault(t => t.active);
        if (previous == null || previous.Tabs.Count != tabs.Count)
          Add(report.browser, "tabs", tabs.Count + " tabs");
        if ((active == null ? -1 : active.id) != (prior == null ? -1 : prior.id) || (active != null && prior != null && active.title != prior.title))
          Add(report.browser, "active tab", active == null ? "None" : (active.title ?? "Untitled") + " | " + SafeUrl(active.url));
        var oldPlaying = previous == null ? "" : String.Join("|", previous.Videos.Where(v => v.playing).Select(v => v.tabId + ":" + v.title));
        var newPlaying = String.Join("|", videos.Where(v => v.playing).Select(v => v.tabId + ":" + v.title));
        if (oldPlaying != newPlaying) Add(report.browser, "video", String.IsNullOrEmpty(newPlaying) ? "No reported video playing" : newPlaying);
        browsers[report.browser] = new BrowserSnapshot { Name = report.browser, SeenUtc = DateTime.UtcNow, Tabs = tabs, Videos = videos };
        if (oldSignature != newSignature) dirty = true;
      }
    }
    public void SetSystem(int? newVolume, bool? newMuted, int? newBrightness, List<MediaInfo> newMedia, Dictionary<string, string> newSources = null) {
      lock (gate) {
        bool changed = volume != newVolume || muted != newMuted || brightness != newBrightness;
        if (newSources != null) {
          changed |= newSources.Any(pair => !signalSources.ContainsKey(pair.Key) || signalSources[pair.Key] != pair.Value);
          signalSources = new Dictionary<string, string>(newSources);
        }
        if (volume != newVolume || muted != newMuted) Add("system", "volume", newVolume.HasValue ? newVolume + "%" + (newMuted == true ? " muted" : "") : "Unavailable");
        if (brightness != newBrightness) Add("system", "brightness", newBrightness.HasValue ? newBrightness + "%" : "Unavailable");
        var oldMedia = String.Join("|", media.Select(m => m.Source + ":" + m.Title));
        var nextMedia = String.Join("|", newMedia.Select(m => m.Source + ":" + m.Title));
        changed |= oldMedia != nextMedia;
        if (oldMedia != nextMedia) Add("media", "playing", String.IsNullOrEmpty(nextMedia) ? "No reported media session" : nextMedia);
        volume = newVolume; muted = newMuted; brightness = newBrightness; media = newMedia;
        if (changed) dirty = true;
      }
    }
    public void SetPower(int? percent, bool? ac, bool? isCharging) {
      lock (gate) {
        if (batteryPercent == percent && onAcPower == ac && charging == isCharging) return;
        batteryPercent = percent; onAcPower = ac; charging = isCharging;
        Add("system", "battery", percent.HasValue ? percent + "%" + (ac == true ? " charging" : "") : "Unavailable");
        dirty = true;
      }
    }
    public void SetActivity(UserActivitySnapshot newActivity, List<string> events) {
      lock (gate) {
        if (events != null) {
          foreach (var evt in events) Add("user", "activity", evt);
        }
        activity = newActivity;
        dirty = true;
      }
    }
    public List<WindowInfo> GetCurrentWindows() {
      lock (gate) {
        return new List<WindowInfo>(windows);
      }
    }
    public Snapshot Read(out bool changed) {
      lock (gate) {
        changed = dirty; dirty = false;
        return new Snapshot { Windows = new List<WindowInfo>(windows), Browsers = browsers.Values.Select(b => new BrowserSnapshot {
          Name = b.Name, SeenUtc = b.SeenUtc, Tabs = new List<BrowserTab>(b.Tabs), Videos = new List<VideoState>(b.Videos) }).ToList(),
          Volume = volume, Muted = muted, Brightness = brightness, BatteryPercent = batteryPercent, OnAcPower = onAcPower, Charging = charging, Media = new List<MediaInfo>(media),
          Activity = activity, SignalSources = new Dictionary<string, string>(signalSources),
          Recent = new List<ActivityRecord>(recent) };
      }
    }
  }
}
