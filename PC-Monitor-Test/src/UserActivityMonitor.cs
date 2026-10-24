using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;

namespace PcMonitorTest {
  public enum UserNotificationState {
    NotPresent = 1,             // Lock screen, screen saver, switched user
    Busy = 2,                   // Full-screen exclusive application
    RunningD3DFullScreen = 3,   // D3D full-screen game / 3D application
    PresentationMode = 4,       // Presentation mode (PowerPoint / display projecting)
    AcceptsNotifications = 5,   // Normal active desktop
    QuietTime = 6,              // Windows Quiet Hours / Focus Assist
    App = 7                     // Windows Store / UWP full-screen application
  }

  [StructLayout(LayoutKind.Sequential)]
  struct LASTINPUTINFO {
    public uint cbSize;
    public uint dwTime;
  }

  public sealed class UserActivityMonitor {
    [DllImport("user32.dll")]
    static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

    [DllImport("kernel32.dll")]
    static extern uint GetTickCount();

    [DllImport("shell32.dll")]
    static extern int SHQueryUserNotificationState(out UserNotificationState pquns);

    readonly int idleThresholdSeconds;
    readonly Dictionary<string, double> appActiveSeconds = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
    readonly object gate = new object();

    double totalActiveSeconds;
    double totalIdleSeconds;
    bool wasIdle;
    UserNotificationState lastNotificationState = UserNotificationState.AcceptsNotifications;

    public int IdleSeconds { get; private set; }
    public bool IsIdle { get; private set; }
    public UserNotificationState NotificationState { get; private set; }
    public double TotalActiveSeconds { get { lock (gate) return totalActiveSeconds; } }
    public double TotalIdleSeconds { get { lock (gate) return totalIdleSeconds; } }

    public UserActivityMonitor(int idleThresholdSec = 60) {
      idleThresholdSeconds = Math.Max(10, idleThresholdSec);
      NotificationState = UserNotificationState.AcceptsNotifications;
    }

    public void RefreshSensors() {
      // Query LastInputInfo (Idle / AFK detection)
      try {
        LASTINPUTINFO lii = new LASTINPUTINFO();
        lii.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO));
        if (GetLastInputInfo(ref lii)) {
          uint nowTicks = GetTickCount();
          uint idleMs = nowTicks - lii.dwTime;
          IdleSeconds = (int)(idleMs / 1000);
          IsIdle = IdleSeconds >= idleThresholdSeconds;
        } else {
          IdleSeconds = -1;
          IsIdle = false;
        }
      } catch {
        IdleSeconds = -1;
        IsIdle = false;
      }

      // Query SHQueryUserNotificationState (Presentation, D3D fullscreen, away / lock screen)
      try {
        UserNotificationState state;
        if (SHQueryUserNotificationState(out state) == 0) {
          NotificationState = state;
        } else {
          NotificationState = UserNotificationState.AcceptsNotifications;
        }
      } catch {
        NotificationState = UserNotificationState.AcceptsNotifications;
      }
    }

    public void Update(string currentForegroundApp, double deltaSeconds, out List<string> events) {
      events = new List<string>();
      RefreshSensors();

      lock (gate) {
        // Track state transitions for history logging
        if (IsIdle && !wasIdle) {
          events.Add("User inactive for " + IdleSeconds + "s (AFK - dwell timers paused)");
          wasIdle = true;
        } else if (!IsIdle && wasIdle) {
          events.Add("User active / returned from AFK (dwell timers resumed)");
          wasIdle = false;
        }

        if (NotificationState != lastNotificationState) {
          if (NotificationState == UserNotificationState.NotPresent) {
            events.Add("User not present / screen locked (dwell timers paused)");
          } else if (NotificationState == UserNotificationState.RunningD3DFullScreen) {
            events.Add("Entered D3D Full-screen mode (gaming / exclusive)");
          } else if (NotificationState == UserNotificationState.PresentationMode) {
            events.Add("Entered Presentation mode (Do Not Disturb)");
          } else if (lastNotificationState == UserNotificationState.NotPresent && NotificationState == UserNotificationState.AcceptsNotifications) {
            events.Add("Screen unlocked / desktop active");
          }
          lastNotificationState = NotificationState;
        }

        // True user presence condition:
        // Pauses timers and marks periods as away/idle if user is idle OR screen is locked/not present
        bool userActive = !IsIdle && NotificationState != UserNotificationState.NotPresent;

        if (deltaSeconds > 0 && deltaSeconds < 10) {
          if (userActive) {
            totalActiveSeconds += deltaSeconds;
            if (!String.IsNullOrEmpty(currentForegroundApp)) {
              double current;
              appActiveSeconds.TryGetValue(currentForegroundApp, out current);
              appActiveSeconds[currentForegroundApp] = current + deltaSeconds;
            }
          } else {
            totalIdleSeconds += deltaSeconds;
          }
        }
      }
    }

    public UserActivitySnapshot GetSnapshot(string currentForegroundApp) {
      lock (gate) {
        var list = new List<AppDwellInfo>();
        double total = totalActiveSeconds > 0 ? totalActiveSeconds : 1.0;

        foreach (var pair in appActiveSeconds.OrderByDescending(p => p.Value)) {
          double pct = totalActiveSeconds > 0 ? (pair.Value / total) * 100.0 : 0;
          list.Add(new AppDwellInfo {
            App = pair.Key,
            ActiveSeconds = pair.Value,
            Percent = Math.Round(pct, 1),
            FormattedTime = FormatDuration(pair.Value),
            IsCurrent = String.Equals(pair.Key, currentForegroundApp, StringComparison.OrdinalIgnoreCase) && !IsIdle && NotificationState != UserNotificationState.NotPresent
          });
        }

        return new UserActivitySnapshot {
          IdleSeconds = IdleSeconds,
          IsIdle = IsIdle,
          NotificationState = NotificationStateText(NotificationState),
          IsPresentationOrFullscreen = NotificationState == UserNotificationState.RunningD3DFullScreen ||
                                      NotificationState == UserNotificationState.PresentationMode ||
                                      NotificationState == UserNotificationState.Busy ||
                                      NotificationState == UserNotificationState.App,
          TotalActiveSeconds = totalActiveSeconds,
          TotalIdleSeconds = totalIdleSeconds,
          DwellTimes = list
        };
      }
    }

    public static string NotificationStateText(UserNotificationState state) {
      switch (state) {
        case UserNotificationState.NotPresent: return "Not Present (Locked/Away)";
        case UserNotificationState.Busy: return "Busy (Exclusive Full-screen)";
        case UserNotificationState.RunningD3DFullScreen: return "D3D Full-screen (Game/App)";
        case UserNotificationState.PresentationMode: return "Presentation Mode";
        case UserNotificationState.AcceptsNotifications: return "Normal";
        case UserNotificationState.QuietTime: return "Quiet Hours";
        case UserNotificationState.App: return "Full-screen App";
        default: return state.ToString();
      }
    }

    public static string FormatDuration(double totalSec) {
      int sec = (int)Math.Max(0, Math.Round(totalSec));
      if (sec < 60) return sec + "s";
      int mins = sec / 60;
      int remSec = sec % 60;
      if (mins < 60) {
        return remSec > 0 ? mins + "m " + remSec + "s" : mins + "m";
      }
      int hours = mins / 60;
      int remMins = mins % 60;
      return remMins > 0 ? hours + "h " + remMins + "m" : hours + "h";
    }
  }
}
