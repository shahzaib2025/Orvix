import type { FastTaskContext } from "./desktop";

type Previous = { name: string; response: Record<string, unknown> };
const unsuccessful = new Set(["failed", "error", "unavailable", "not_found", "no_results", "no_relevant_sources", "partial", "blocked", "stale_target", "invalid_target_type", "invalid_request", "stale_revision", "plan_required", "out_of_scope", "timeout", "limit_reached"]);
export function fastToolAcknowledgment(name: string, args: Record<string, unknown>, lang: "bn" | "en", context?: FastTaskContext, previous?: Previous): string {
  const en = lang === "en";
  let next: string;
  if (name === "plan_task") next = en ? "I’m dividing your request into steps and checking their order." : "প্রথমে কাজের ধাপগুলো সাজিয়ে নিচ্ছি।";
  else if (name === "review_task") {
    const comparison = /compar|versus|তুলনা/i.test(context?.goal || "") || context?.requirements.some(item => /compar|তুলনা/i.test(item.text));
    const readable = context?.evidence?.filter(item => item.verified && !item.negativeRead && !item.scopeOnly && item.sourceUrl && String(item.excerpt || "").trim().length >= 80) || [];
    next = comparison && readable.length < 2 ? en ? "I’m checking what evidence is available for the comparison and what is still missing." : "তুলনার জন্য কী প্রমাণ আছে এবং কী বাকি আছে দেখছি।"
      : comparison ? en ? "I’m comparing the collected information and checking that the report covers your request with evidence." : "এবার তথ্য মিলিয়ে তুলনা এবং প্রমাণ যাচাই করছি।"
      : en ? "I’m checking the report against the evidence and each part of your request." : "প্রমাণের সঙ্গে মিলিয়ে রিপোর্টের প্রতিটি অংশ যাচাই করছি।";
  }
  else if (name === "web_search") {
    const query = String(args.query || "");
    const google = /gemini|google|জেমিনি|গুগল/i.test(query);
    const openai = /openai|chatgpt|\bgpt\b|ওপেনএআই|জিপিটি/i.test(query);
    const latest = /latest|newest|লেটেস্ট|সর্বশেষ|নতুন/i.test(query);
    next = latest && google !== openai
      ? en ? `I’m looking for ${google ? "Google’s" : "OpenAI’s"} latest models and their official information.` : `${google ? "গুগলের" : "ওপেনএআই-এর"} নতুন মডেলগুলোর তথ্য দেখছি।`
      : en ? /return|refund|ফেরত/i.test(query) ? "I’m looking up the return and refund policy." : /price|cost|দাম|খরচ/i.test(query) ? "I’m checking the published prices and costs." : "I’m searching online for the information your question needs."
        : /return|refund|ফেরত/i.test(query) ? "পণ্য ফেরত এবং টাকা ফেরতের নিয়ম খুঁজছি।"
        : /price|cost|দাম|খরচ/i.test(query) ? "প্রয়োজনীয় দাম এবং খরচের তথ্য খুঁজছি।" : "আপনার প্রশ্নের প্রাসঙ্গিক তথ্য অনলাইনে খুঁজছি।";
  } else if (name === "read_web_page") {
    let publisher = en ? "the source page" : "সূত্রের পৃষ্ঠা";
    try {
      const host = new URL(String(args.url)).hostname;
      publisher = /(^|\.)openai\.com$/.test(host) ? "OpenAI" : /(^|\.)(google\.com|google\.dev|blog\.google)$/.test(host) ? "Google" : en ? "the selected source page" : "সূত্রের পৃষ্ঠা";
    } catch { /* A malformed URL is handled by the executor. */ }
    next = en ? `I’m reading ${publisher} to check the information needed for your request.` : "এই উৎস থেকে প্রয়োজনীয় তথ্য পড়ে যাচাই করছি।";
  } else if (!en) {
    const starts: Record<string, string> = {
      browser_observe: "ব্রাউজারের বর্তমান অবস্থা দেখছি।", desktop_observe: "কম্পিউটারের বর্তমান অবস্থা দেখছি।",
      browser_act: "ব্রাউজারে আপনার চাওয়া কাজটি করছি।", work_browser: "ব্রাউজারে আপনার চাওয়া কাজটি করছি।",
      desktop_act: "কম্পিউটারে আপনার চাওয়া কাজটি করছি।", manage_window: "আপনার চাওয়া উইন্ডোটি সামনে আনছি।",
      read_file: "নির্বাচিত ফাইলের তথ্য পড়ছি।", write_file: "নির্বাচিত ফাইলে আপনার চাওয়া পরিবর্তন লিখছি।",
      list_directory: "নির্বাচিত ফোল্ডারের ফাইলগুলো দেখছি।", search_files: "আপনার চাওয়া ফাইলটি খুঁজছি।", search_content: "ফাইলের মধ্যে প্রয়োজনীয় তথ্য খুঁজছি।",
      get_weather: "চাওয়া এলাকার বর্তমান আবহাওয়া যাচাই করছি।", manage_clipboard: "আপনার চাওয়া ক্লিপবোর্ডের কাজটি করছি।",
      search_class10_textbook: "বইয়ের মধ্যে প্রয়োজনীয় অংশটি খুঁজছি।", read_class10_textbook_pages: "বইয়ের প্রয়োজনীয় পৃষ্ঠাগুলো পড়ছি।",
    };
    next = starts[name] || "পরের ধাপের প্রয়োজনীয় কাজটি করছি।";
  }
  else {
    const starts: Record<string, string> = {
      browser_observe: "I’m checking the current browser state.", desktop_observe: "I’m checking the current desktop state.",
      browser_act: "I’m performing the requested browser action.", work_browser: "I’m performing the requested browser action.",
      desktop_act: "I’m performing the requested desktop action.", manage_window: "I’m performing the requested window operation.",
      read_file: "I’m reading the selected file.", write_file: "I’m writing the requested changes to the selected file.",
      list_directory: "I’m checking the files in the selected folder.", search_files: "I’m looking for the requested file.", search_content: "I’m searching the files for the needed information.",
      get_weather: "I’m checking the current weather for the requested location.", manage_clipboard: "I’m performing the requested clipboard operation.",
      search_class10_textbook: "I’m finding the relevant section in the textbook.", read_class10_textbook_pages: "I’m reading the relevant textbook pages.",
      run_workflow: "I’m working through the requested workflow.", draft_tiny_agent: "I’m preparing the requested rule for your review.", draft_tiny_workflow: "I’m preparing the requested workflow for your review.",
    };
    next = starts[name] || "I’m performing the next requested step.";
  }
  // Never turn an attempted operation or an accessible page into a success claim.
  const result = previous?.response;
  if (result && ["confirmation_required", "awaiting_confirmation", "review_required"].includes(String(result.status))) return (en ? "The previous step still needs your approval. " : "আগের ধাপটির জন্য আপনার অনুমোদন এখনো বাকি। ") + next;
  if (result && ["needs_selection", "needs_clarification"].includes(String(result.status))) return (en ? "The previous step still needs a choice or clarification. " : "আগের ধাপটির জন্য নির্বাচন বা স্পষ্ট নির্দেশনা এখনো বাকি। ") + next;
  if (result && (result.error || result.completionUnknown === true || unsuccessful.has(String(result.status)))) {
    const unknown = result.completionUnknown === true;
    return (en ? unknown ? "The previous action’s outcome is uncertain; I’ll check its state before any retry. " : "The previous attempt did not provide a verified result. "
      : unknown ? "আগের কাজটির ফল নিশ্চিত নয়; আবার করার আগে বর্তমান অবস্থা যাচাই করব। " : "আগের চেষ্টায় যাচাই করা ফল পাওয়া যায়নি। ") + next;
  }
  if (name === "web_search" && previous?.name === "read_web_page" && result?.status === "ok" && result.source === "direct_page" && String(result.content || "").trim().length >= 80) {
    let host = "";
    try { host = new URL(String(result.url || "")).hostname; } catch { /* No publisher receipt without an observed URL. */ }
    const query = String(args.query || "");
    if (/(^|\.)(google\.com|google\.dev|blog\.google)$/.test(host) && /openai|chatgpt|\bgpt\b|ওপেনএআই|জিপিটি/i.test(query)) return (en ? "I’ve read the Google page. " : "গুগলের পৃষ্ঠার তথ্য পড়েছি। ") + next;
    if (/(^|\.)openai\.com$/.test(host) && /google|gemini|গুগল|জেমিনি/i.test(query)) return (en ? "I’ve read the OpenAI page. " : "ওপেনএআই-এর পৃষ্ঠার তথ্য পড়েছি। ") + next;
  }
  return next;
}
