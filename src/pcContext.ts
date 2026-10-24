import type { PcSnapshot } from "./desktop";

function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  if (total < 60) return `${total}s`;
  const mins = Math.floor(total / 60);
  const remSec = total % 60;
  if (mins < 60) return remSec > 0 ? `${mins}m ${remSec}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}

/**
 * Compact 4-line PC context for the Fast Profile.
 * Kept ultra-concise to preserve sub-second voice latency while giving Orvix
 * instant answers for active app, open file, current music, and dwell time.
 */
export function formatFastPcContext(snapshot: PcSnapshot | null): string {
  if (!snapshot) {
    return "\nCURRENT PC STATE: Monitor starting up or temporarily unavailable.";
  }

  const activeWin = snapshot.Windows?.find(w => w.Active);
  const hasValidDoc = Boolean(activeWin?.Document && !activeWin.Document.startsWith("Unknown"));
  const activeApp = activeWin ? `${activeWin.App}${hasValidDoc ? ` [${activeWin.Document}]` : ` (${activeWin.Title.slice(0, 50)})`}` : "None (Desktop)";
  const winState = activeWin?.State ? ` [${activeWin.State}]` : "";

  // Dwell time for the current app
  const currentDwell = snapshot.Activity?.DwellTimes?.find(d => d.IsCurrent);
  const dwellStr = currentDwell ? ` | Focused: ${currentDwell.FormattedTime}` : "";

  // Other open apps & windows (up to 5)
  const otherList = (snapshot.Windows ?? [])
    .filter(w => !w.Active)
    .slice(0, 5)
    .map(w => {
      const hasDoc = Boolean(w.Document && !w.Document.startsWith("Unknown") && w.Document !== "None");
      return `${w.App}${hasDoc ? ` [${w.Document}]` : ""}`;
    });
  const otherStr = otherList.length > 0 ? `\n- Background / Open Windows: ${otherList.join(", ")}` : "";

  // Media
  let mediaStr = "No music/media playing";
  if (snapshot.Media && snapshot.Media.length > 0) {
    const m = snapshot.Media[0];
    mediaStr = `${m.Source}: "${m.Title}"${m.Artist ? ` by ${m.Artist}` : ""}`;
  } else if (snapshot.Browsers?.some(b => b.Videos?.some(v => v.playing))) {
    const v = snapshot.Browsers.flatMap(b => b.Videos).find(v => v.playing);
    if (v) mediaStr = `Browser Video: "${v.title}"`;
  }
  const volStr = snapshot.Volume !== null && snapshot.Volume !== undefined ? ` | Vol: ${snapshot.Volume}%${snapshot.Muted ? " (muted)" : ""}` : "";

  // Presence
  const isIdle = snapshot.Activity?.IsIdle ?? false;
  const idleSec = snapshot.Activity?.IdleSeconds ?? 0;
  const presenceStr = isIdle ? `[IDLE / AFK for ${formatDuration(idleSec)}] (dwell paused)` : `Actively working (${idleSec}s idle)`;
  const modeStr = snapshot.Activity?.NotificationState ? ` | Mode: ${snapshot.Activity.NotificationState}` : "";
  const browserStr = (snapshot.Browsers ?? []).map(browser => {
    const age = Math.max(0, Math.round((Date.now() - Date.parse(browser.SeenUtc)) / 1000));
    const tabs = browser.Tabs.slice(0, 12).map(tab => `${tab.active ? "active " : ""}${tab.title.slice(0, 70)}${tab.muted ? " [muted]" : ""}`).join("; ");
    return `${browser.Name} (${age}s old${age > 5 ? ", stale; verify before acting" : ""}): ${tabs || "no tabs"}`;
  }).join(" | ");

  const pairedBrowser = snapshot.BrowserContext ? JSON.stringify({
    connected: snapshot.BrowserContext.connected,
    ageMs: snapshot.BrowserContext.ageMs,
    totalTabs: snapshot.BrowserContext.totalTabs,
    tabs: snapshot.BrowserContext.tabs.slice(0, 8).map(t => ({ref:t.ref,title:String(t.title||'').slice(0,100),url:t.url,windowId:t.windowId,active:t.active,audible:t.audible,muted:t.muted,discarded:t.discarded,status:t.status,pendingUrl:t.pendingUrl,lastAccessed:t.lastAccessed})),
    moreTabs: Math.max(0, snapshot.BrowserContext.totalTabs - Math.min(snapshot.BrowserContext.totalTabs, 8)),
  }) : 'Unavailable';

  return `
CURRENT PC STATE & WORKING MEMORY (ANSWER INSTANTLY WITHOUT TOOLS):
- Active App & File: ${activeApp}${winState}${dwellStr}${otherStr}
- Playing Media: ${mediaStr}${volStr}
- Browser tabs: ${browserStr || "No browser monitor report"}. Use browser_act for Chrome tabs; identify the actual target, never substitute another app.
- Paired browser awareness: ${pairedBrowser}. This is tab metadata only, not page contents. Metadata older than two seconds needs refresh before choosing a target. Read current page controls only for the relevant task; existing matching tabs should be reused.
- User Presence: ${presenceStr}${modeStr}`;
}

/**
 * Rich multi-dimensional PC context for the Thinking Profile.
 * Provides complete visibility across open windows, browser tabs, media,
 * dwell times, and user presence for deep reasoning and daily workflow summaries.
 */
export function formatThinkingPcContext(snapshot: PcSnapshot | null): string {
  if (!snapshot) {
    return "\nREAL-TIME PC & DESKTOP GROUNDING: Monitor starting up or temporarily unavailable.";
  }

  const activeWin = snapshot.Windows?.find(w => w.Active);
  const hasDoc = Boolean(activeWin?.Document && !activeWin.Document.startsWith("Unknown"));
  const foregroundStr = activeWin
    ? `${activeWin.App} | Title: "${activeWin.Title}"${hasDoc ? ` | File/Document: ${activeWin.Document}` : ""} (${activeWin.State})`
    : "No active top-level window focused";

  // Media
  const mediaLines: string[] = [];
  if (snapshot.Media && snapshot.Media.length > 0) {
    for (const m of snapshot.Media) {
      mediaLines.push(`${m.Source}: "${m.Title}"${m.Artist ? ` — ${m.Artist}` : ""}`);
    }
  }
  for (const b of snapshot.Browsers ?? []) {
    for (const v of b.Videos?.filter(v => v.playing) ?? []) {
      mediaLines.push(`${b.Name} Video: "${v.title}"${v.muted ? " [muted]" : ""}`);
    }
  }
  const mediaStr = mediaLines.length > 0 ? mediaLines.join(" | ") : "No active audio/video media session";
  const systemSound = snapshot.Volume !== null && snapshot.Volume !== undefined ? `System Volume: ${snapshot.Volume}%${snapshot.Muted ? " (muted)" : ""}` : "";
  const displayBright = snapshot.Brightness !== null && snapshot.Brightness !== undefined ? `Display Brightness: ${snapshot.Brightness}%` : "";
  const hardwareStr = [systemSound, displayBright].filter(Boolean).join(" | ");

  // Presence & Mode
  const act = snapshot.Activity;
  const presenceStr = act
    ? `${act.IsIdle ? `[IDLE / AFK for ${formatDuration(act.IdleSeconds)}] (dwell timers paused)` : `Actively working (inactivity: ${act.IdleSeconds}s)`} | Display Mode: ${act.NotificationState}`
    : "Presence status unavailable";

  // Other visible/background windows (with document & state)
  const otherWindows = (snapshot.Windows ?? [])
    .filter(w => !w.Active)
    .slice(0, 8)
    .map(w => {
      const hasWDoc = Boolean(w.Document && !w.Document.startsWith("Unknown") && w.Document !== "None");
      const docDetail = hasWDoc ? ` [${w.Document}]` : w.Title ? ` - "${w.Title.slice(0, 45)}"` : "";
      return `${w.App} (${w.State})${docDetail}`;
    });
  const windowsStr = otherWindows.length > 0 ? otherWindows.join(", ") : "None";

  // Browser Tabs
  const browserSummaries: string[] = [];
  for (const b of snapshot.Browsers ?? []) {
    const tabCount = b.Tabs?.length ?? 0;
    const activeTab = b.Tabs?.find(t => t.active);
    const activeTabStr = activeTab ? ` | Active: "${activeTab.title}"` : "";
    browserSummaries.push(`${b.Name}: ${tabCount} tabs${activeTabStr}`);
  }
  const browserStr = browserSummaries.length > 0 ? browserSummaries.join(" | ") : "Browser extension not connected";

  // App Dwell Distribution
  const dwellLines: string[] = [];
  if (act?.DwellTimes && act.DwellTimes.length > 0) {
    for (const d of act.DwellTimes.slice(0, 5)) {
      dwellLines.push(`  * ${d.App}: ${d.FormattedTime} (${d.Percent}%)${d.IsCurrent ? " [Currently Focused]" : ""}`);
    }
  }
  const sessionTotal = act ? `Total Session: ${formatDuration(act.TotalActiveSeconds)} active, ${formatDuration(act.TotalIdleSeconds)} idle/away` : "";

  return `
REAL-TIME DESKTOP, WINDOWS & USER PRESENCE GROUNDING:
- Foreground Active App: ${foregroundStr}
- Currently Playing Media: ${mediaStr}${hardwareStr ? `\n- Hardware Vitals: ${hardwareStr}` : ""}
- User Presence & Display State: ${presenceStr}
- Other Visible Windows: ${windowsStr}
- Open Browser Tabs: ${browserStr}
${dwellLines.length > 0 ? `- Today's App Dwell Time Distribution:\n${dwellLines.join("\n")}\n  * ${sessionTotal}` : `- Session Time: ${sessionTotal}`}`;
}
