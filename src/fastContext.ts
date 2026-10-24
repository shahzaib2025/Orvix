import type { FastTaskContext } from "./desktop";

// Transport projection only; completion review uses the full controller ledger.
export function fastModelContext(context?: FastTaskContext) {
  if (!context) return undefined;
  const terms = new Set((String(context.latestRequest || context.goal || "").toLowerCase().match(/[\p{L}\p{M}\p{N}]{3,}/gu) || []));
  const evidence = context.evidence || [];
  const ranked = evidence.map((e, index) => ({ e, index, score:
    [...terms].filter(term => String(e.excerpt || e.sourceUrl || "").toLowerCase().includes(term)).length }))
    .sort((a, b) => b.score - a.score || b.index - a.index);
  const excerpts = new Set(ranked.slice(0, 8).map(item => item.index));
  return { ...context, evidence: evidence.map((e, index) => {
    if(!["read_web_page","web_search"].includes(String(e.tool)))return {...e};
    const {excerpt, ...metadata}=e;
    return {...metadata, ...(excerpts.has(index) ? {excerpt:String(excerpt || "").slice(0,2200)} : {})};
  }), instruction: "Excerpts may be omitted or shortened for transport. Reread a source when its needed quote is absent; omitted text does not prove absence. Use the observed evidenceId and sourcePassageId exactly; never invent IDs or use a search aggregate as a page quote." };
}
