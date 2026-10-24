// Completion wording is selected from browser evidence, never model narration.
function legacyBrowserOutcomeText(action: string, args: Record<string, unknown>, result: Record<string, unknown>, en: boolean): string {
  if (result.status === "confirmation_required") {
    const target = typeof result.target === "string" ? result.target.slice(0, 120) : "";
    return en
      ? `Waiting for your confirmation${target ? ` for ${target}` : ""}. Use Confirm action in Orvix's review dialog. This action has not run yet.`
      : `${target ? `${target}-এর জন্য ` : ""}আপনার অনুমতির অপেক্ষায় আছি। Orvix-এর রিভিউ ডায়ালগে Confirm action চাপুন। কাজটি এখনো চালানো হয়নি।`;
  }
  if (result.status === "needs_selection") {
    const options = Array.isArray(result.options) ? result.options as Record<string, unknown>[] : [];
    const youtube = action.startsWith("youtube_");
    return (youtube ? (en ? "Videos and playlists in page order: " : "পেজের ক্রম অনুযায়ী ভিডিও ও প্লেলিস্ট: ") : (en ? "Matching browser targets: " : "মিলে যাওয়া ব্রাউজারের লক্ষ্যগুলো: ")) + options.slice(0, 6).map((item, index) =>
      `${index + 1}. ${String(item.title || "").slice(0, 180)}${item.kind === "playlist" ? (en ? " (playlist)" : " (প্লেলিস্ট)") : ""}${item.channel ? ` — ${String(item.channel).slice(0, 100)}` : ""}`).join("; ") + (en ? ". Which number?" : "। কোন নম্বরটি চান?");
  }
  const verification = result.verification as { verified?: boolean } | undefined;
  if (result.status !== "ok" || result.completionUnknown === true || verification?.verified === false) {
    if (result.completionUnknown !== true && ["stale_target", "invalid_target_type"].includes(String(result.status))) return en
      ? "That action was not completed because the page control reference is missing or changed."
      : "পেজের কন্ট্রোলের রেফারেন্স নেই বা বদলে গেছে, তাই কাজটি সম্পন্ন হয়নি।";
    return en ? "The browser action could not be verified as completed." : "ব্রাউজারের কাজটি সম্পন্ন হয়েছে বলে নিশ্চিত করা যায়নি।";
  }
  const messages: Record<string, [string, string]> = {
    type: ["Text entered in the page control.", "পেজের ঘরে লেখাটি দেওয়া হয়েছে।"],
    key: ["The requested key action was verified.", "কী চাপার ফলাফল যাচাই হয়েছে।"],
    search: ["The requested search page opened.", "অনুরোধ করা সার্চ পেজটি খোলা হয়েছে।"],
    navigate: ["The requested page opened.", "অনুরোধ করা পেজটি খোলা হয়েছে।"],
    tab_open: ["The requested tab opened.", "অনুরোধ করা ট্যাবটি খোলা হয়েছে।"],
    tab_activate: ["The requested tab was selected.", "অনুরোধ করা ট্যাবটি নির্বাচন করা হয়েছে।"],
    scroll: ["The page was scrolled.", "পেজটি স্ক্রল করা হয়েছে।"],
    youtube_pause: ["Playback paused.", "গানটি পজ করা হয়েছে।"],
    youtube_resume: ["Playback resumed.", "গানটি আবার চালু হয়েছে।"],
  };
  if (action === "tab_mute") return args.enabled === false ? (en ? "The tab was unmuted." : "ট্যাবটি আনমিউট হয়েছে।") : (en ? "The tab was muted." : "ট্যাবটি মিউট হয়েছে।");
  if (action === "youtube_search" || action === "youtube_select") return result.playbackState === "playing"
    ? (en ? "The selected video is playing." : "নির্বাচিত ভিডিওটি চলছে।")
    : (en ? "Playback has not been verified." : "ভিডিও চলছে কি না নিশ্চিত করা যায়নি।");
  return messages[action]?.[en ? 0 : 1] || (en ? "The requested browser action was verified." : "অনুরোধ করা ব্রাউজারের কাজটি যাচাই হয়েছে।");
}

export function browserOutcomeText(action: string, args: Record<string, unknown>, result: Record<string, unknown>, en: boolean, refined = false): string {
  const legacy = legacyBrowserOutcomeText(action, args, result, en);
  if (refined && result.status === "ok" && (result.verification as { verified?: boolean } | undefined)?.verified !== true) {
    return en ? "The browser action could not be verified as completed." : "ব্রাউজারের কাজটি সম্পন্ন হয়েছে বলে নিশ্চিত করা যায়নি।";
  }
  if (!refined || result.status !== "ok" || result.completionUnknown === true || (result.verification as { verified?: boolean } | undefined)?.verified === false) return legacy;
  const messages: Record<string, [string, string]> = {
    type: ["The text is entered.", "লেখাটি দেওয়া হয়েছে।"], key: ["The key action took effect.", "কী চাপার কাজটি হয়েছে।"],
    search: ["The search page is open.", "সার্চ পেজটি খুলেছে।"], navigate: ["The page is open.", "পেজটি খুলেছে।"],
    tab_open: ["The tab is open.", "ট্যাবটি খুলেছে।"], tab_activate: ["The tab is selected.", "ট্যাবটি সামনে এসেছে।"],
    scroll: ["The page has been scrolled.", "পেজটি স্ক্রল হয়েছে।"], youtube_pause: ["Playback is paused.", "ভিডিওটি পজ হয়েছে।"],
    youtube_resume: ["Playback has resumed.", "ভিডিওটি আবার চলছে।"],
  };
  return messages[action]?.[en ? 0 : 1] || legacy;
}
