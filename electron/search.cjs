function decodeHtmlEntities(str) {
  if (!str) return "";
  return str
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#([0-9]{1,5});/gi, (_, num) => String.fromCharCode(parseInt(num, 10)));
}
const { isIP } = require("node:net");

function isAllowedPublicHttpsPage(url) {
  return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password
    && !isIP(url.hostname) && !/(^localhost$|\.localhost$|\.local$)/i.test(url.hostname);
}

const recentSearchUrls = new Map();
const SEARCH_URL_TTL_MS = 10 * 60 * 1000;
const SEARCH_QUERY_CACHE = new Map();
const SEARCH_QUERY_CACHE_TTL_MS = 5 * 60 * 1000;
let searchBlockedUntil = 0;

const { configureSearchKeys, getSearchKeys, searchSerper } = require('./serper-search.cjs');

function parseSearchResults(html) {
  const results = [];
  const resultBlocks = html.split('<div class="result results_links results_links_deep web-result');
  for (let i = 1; i < resultBlocks.length && results.length < 10; i++) {
    const block = resultBlocks[i];
    const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/s);
    const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/s);
    if (!titleMatch && !snippetMatch) continue;
    let url = titleMatch ? titleMatch[1] : "";
    try {
      const parsed = new URL(url, "https://duckduckgo.com");
      url = parsed.searchParams.get("uddg") || parsed.href;
    } catch { continue; }
    const title = decodeHtmlEntities(titleMatch ? titleMatch[2].replace(/<[^>]+>/g, "").trim() : "No title");
    const snippet = decodeHtmlEntities(snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, "").trim() : "");
    if (title || snippet) results.push({ title, snippet, url });
  }
  return results;
}

async function requestSearch(query, signal, freshness) {
  if (Date.now() < searchBlockedUntil) throw new Error("Search provider cooldown is active.");
  const periods={oneDay:'d',oneWeek:'w',oneMonth:'m',oneYear:'y'};
  const response = await fetch(`https://duckduckgo.com/html/?${new URLSearchParams({ q: query, ...(periods[freshness]?{df:periods[freshness]}:{}) })}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000),
  });
  const html = await response.text();
  if (response.status !== 200 || /anomaly-modal|bot challenge|captcha|unusual traffic/i.test(html)) {
    searchBlockedUntil = Date.now() + 60_000;
    throw new Error(`Search provider blocked the request (HTTP ${response.status}).`);
  }
  return parseSearchResults(html);
}

async function searchWeb(input = {}, options = {}) {
  const query = typeof input === 'string' ? input.trim() : String(input?.query || '').trim();
  const store = getSearchKeys();
  try {
    store?.count('queries');
    console.log(`[Orvix Live Tool: web_search] Query: "${query}"`);
    if (!query) return { status: 'no_results', query, count: 0, results: [], message: 'Please provide a search query.' };
    const freshness = typeof input === 'object' ? input?.freshness : undefined;
    const refresh = typeof input === 'object' && (input?.refresh === true || ['oneDay','oneWeek','oneMonth','oneYear'].includes(freshness));
    const queryKey = JSON.stringify([query.toLowerCase(), freshness ?? null, store?.revision() ?? 0]);
    const cached = SEARCH_QUERY_CACHE.get(queryKey);
    if (!refresh && cached && Date.now() - cached.time < SEARCH_QUERY_CACHE_TTL_MS) {
      store?.count('cacheHits');
      store?.recordProvider(cached.data.provider + ' (cached)');
      console.log('[Orvix Live Tool: web_search] Returned cached evidence:', JSON.stringify({provider:cached.data.provider,scope:'search_excerpts',results:cached.data.results}));
      return { ...cached.data, cached: true };
    }
    if (refresh) console.log('[Orvix Live Tool: web_search] Explicit refresh bypassed the local query cache.');
    let results = [], provider = 'Serper', fallbackReason = 'no useful Serper results';
    console.log('[Orvix Live Tool: web_search] Trying Serper first.');
    try { results = await searchSerper(query, freshness, fetch, options.signal); }
    catch (error) { fallbackReason = 'Serper unavailable'; console.warn(`[Orvix Live Tool: web_search] ${error.message}`); }
    if(options.signal?.aborted)return {status:'cancelled',query,count:0,results:[]};
    const { assessSearch } = require('./agent/research-quality.cjs');
    let quality = assessSearch(query, results);
    if (!quality.results.length) {
      provider = 'DuckDuckGo';
      console.log(`[Orvix Live Tool: web_search] Trying DuckDuckGo: ${fallbackReason}.`);
      try {
        if (Date.now() < searchBlockedUntil) throw new Error('DuckDuckGo cooldown active.');
        store?.count('fallbackCalls');
        results = await requestSearch(query, options.signal, freshness);
        store?.count('fallbackSuccesses');
        quality = assessSearch(query, results);
      } catch {
        if(options.signal?.aborted)return {status:"cancelled",query,count:0,results:[]};
        console.warn('[Orvix Live Tool: web_search] DuckDuckGo unavailable; known official webpage is the final fallback.');
        searchBlockedUntil = Math.max(searchBlockedUntil, Date.now() + 30000);
        store?.recordProvider('Unavailable');
        return { status: 'unavailable', query, count: 0, results: [], provider,
          retryAfterMs: Math.max(1000, searchBlockedUntil - Date.now()),
          message: 'Serper and DuckDuckGo search are unavailable. Do not repeat this search unchanged or invent findings. Direct page reads remain available.' };
      }
    }
    for (const result of quality.results) {
      recentSearchUrls.set(result.url, { time: Date.now(), title: result.title, content: result.content || '' });
      recentSearchUrls.set(result.url.replace(/\/+$/, ''), { time: Date.now(), title: result.title, content: result.content || '' });
    }
    for (const [url, entry] of recentSearchUrls) if (Date.now() - entry.time > SEARCH_URL_TTL_MS) recentSearchUrls.delete(url);
    console.log(`[Orvix Live Tool: web_search] ${provider} found ${quality.results.length} relevant results.`);
    const maxResults = typeof input === 'object' && Number.isInteger(input?.limit) ? Math.min(Math.max(1, input.limit), 15) : 10;
    const payload = { status: 'ok', provider, query, retrievedAt:new Date().toISOString(), freshness: freshness || null, count: quality.results.slice(0, maxResults).length,
      results: quality.results.slice(0, maxResults), quality: quality.results.length ? 'search_excerpts_require_claim_support' : 'no_relevant_matches',
      rejectedCount: quality.rejectedCount, candidateUrls: quality.candidateUrls, researchGuidance: quality.note + ' Publication dates are source/provider metadata, not independently verified. Undated results have unknown age. Retrieval time and date filters do not establish current factual status; compare release claims with current primary evidence.' };
    console.log('[Orvix Live Tool: web_search] Returned evidence:', JSON.stringify({provider,query,scope:'search_excerpts',results:payload.results.map(({title,url,snippet,date})=>({title,url,snippet,date}))}));
    store?.recordProvider(provider);
    if (SEARCH_QUERY_CACHE.size >= 200) SEARCH_QUERY_CACHE.delete(SEARCH_QUERY_CACHE.keys().next().value);
    SEARCH_QUERY_CACHE.set(queryKey, { time: Date.now(), data: payload });
    return refresh ? { ...payload, cacheBypassed: true } : payload;
  } catch {
    return { status: 'unavailable', query, count: 0, results: [], message: 'Search could not be completed. Check search key storage and provider status.' };
  }
}

async function readSearchResultPage(input = {}, options = {}) {
  let url = typeof input === "string" ? input.trim() : String(input?.url || input?.link || input?.href || input?.target || "").trim();
  if (!url && recentSearchUrls.size > 0) {
    // Pick the most recent searched URL
    const latest = [...recentSearchUrls.entries()].sort((a, b) => b[1].time - a[1].time)[0];
    if (latest) url = latest[0];
  }
  if (!url) {
    return { status: "missing_url", url: "", message: "Provide an exact HTTPS URL to read." };
  }
  let parsed;
  try { parsed = new URL(url); } catch { return { status: "invalid_url", message: "Use an exact URL from a search result." }; }
  if (!isAllowedPublicHttpsPage(parsed)) {
    return { status: "invalid_url", message: "Only public HTTPS search results can be opened." };
  }
  if (parsed.hostname === "ai.google.dev" && !parsed.searchParams.has("hl")) parsed.searchParams.set("hl", "en");
  const searchEntry = recentSearchUrls.get(url) || recentSearchUrls.get(url.replace(/\/+$/, ""));
  try {
    let currentUrl = parsed;
    let response;
    for (let redirectCount = 0; redirectCount <= 3; redirectCount++) {
      response = await fetch(currentUrl, {
        redirect: "manual",
        headers: { accept: "text/html", "Accept-Language": "en-US,en;q=0.9", "User-Agent": "Mozilla/5.0 Orvix/0.1" },
        signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      if (redirectCount === 3) throw new Error("Too many redirects.");
      const target = response.headers.get("location");
      if (!target) throw new Error("Redirect target was missing.");
      currentUrl = new URL(target, currentUrl);
      if (!isAllowedPublicHttpsPage(currentUrl)) throw new Error("Redirect target is not public HTTPS.");
    }
    if (!response.headers.get("content-type")?.includes("text/html")) throw new Error(`Page unavailable (HTTP ${response.status}).`);
    const html = (await response.text()).slice(0, 500_000);
    const title = decodeHtmlEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, "").trim() || "");
    if (/^(?:just a moment|access denied|attention required|checking your browser|please verify)/i.test(title) || /anomaly-modal|cf-chl-/i.test(html))
      return {status:'blocked',url:currentUrl.href,title,source:'direct_page',retrievedAt:new Date().toISOString(),message:'The site returned an access challenge, not the requested article. Do not treat this as a successful page read or evidence for its claims.'};
    const navigation=[...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].flatMap(match=>{
      try {
        const link=new URL(decodeHtmlEntities(match[1]),currentUrl);
        const text=decodeHtmlEntities(match[2].replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim().slice(0,150);
        return isAllowedPublicHttpsPage(link) && link.hostname===currentUrl.hostname && /contact|যোগাযোগ|api(?:\/|\b)|docs?|documentation|guide|tutorial|architecture|overview|spec(?:ification)?|rfc|benchmarks?|internals|github|release-notes|changelog|reference|components|ecosystem|websockets|shop|product|catalog|\/models(?:\/|$)|categor|collection|pagination|next|পরবর্তী|প্রোডাক্ট|পণ্য|[?&](?:page|paged)=/i.test(link.pathname+' '+link.search+' '+text) ? [{url:link.href,title:text}] : [];
      }catch{return [];}
    }).filter((link,index,all)=>all.findIndex(other=>other.url===link.url)===index);
    const links=navigation.slice(0,100), linksTruncated=navigation.length>links.length;
    if(response.status===404 || /^(?:404\b|page not found|not found|404.{0,20}not found)/i.test(title) || /\/(?:404|not-found)(?:\.html)?\/?$/i.test(currentUrl.pathname))return {status:'not_found',url:currentUrl.href,title,source:'direct_page',verified:false,links,message:'The requested document is a not-found page. Its navigation links are leads, not evidence for the missing content.'};
    if(!response.ok)throw new Error(`Page unavailable (HTTP ${response.status}).`);
    const article = html.match(/<(?:main|article)\b[^>]*>([\s\S]*?)<\/(?:main|article)>/i)?.[1] || html;
    const headingIndex = article.search(/<h1\b/i);
    const relevantArticle = headingIndex >= 0 ? article.slice(headingIndex) : article;
    const fullContent = decodeHtmlEntities(relevantArticle
      .replace(/<(script|style|svg|noscript|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(?:p|li|h[1-6]|section)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n+/g, "\n\n")
      .trim());
    if (!fullContent) throw new Error("No readable article text was found.");
    const requestedOffset = Number.isInteger(input?.offset) ? Math.max(0, Math.min(input.offset, fullContent.length)) : 0;
    const query = typeof input?.query === 'string' ? input.query.trim().slice(0, 250) : '';
    const match = query ? fullContent.toLowerCase().indexOf(query.toLowerCase()) : -1;
    const offset = match >= 0 ? Math.max(0, match - 500) : requestedOffset;
    const limit = Number.isInteger(input?.limit) ? Math.min(Math.max(1000, input.limit), 40000) : 16000;
    const content = fullContent.slice(offset, offset + limit);
    console.log(`[Orvix Live Tool: read_web_page] Read ${content.length} characters directly from ${currentUrl.href}`);
    console.log("[Orvix Live Tool: read_web_page] Returned evidence:", JSON.stringify({url:currentUrl.href,scope:"page_excerpt",content}));
    const dateTag=[...html.matchAll(/<meta\b[^>]*>/gi)].map(match=>match[0]).find(tag=>/(?:property|name)=["'](?:article:published_time|datePublished|date)["']/i.test(tag));
    const datePublished=dateTag?.match(/\bcontent=["']([^"']+)["']/i)?.[1];
    return { status: "ok", url: currentUrl.href, title: title || searchEntry?.title || "Web page", retrievedAt:new Date().toISOString(), ...(datePublished?{datePublished}:{}), source: "direct_page", links, linksTruncated, truncated: offset + content.length < fullContent.length, offset, nextOffset:offset+content.length<fullContent.length?offset+content.length:null, totalCharacters:fullContent.length, queryMatched:query ? match>=0 : undefined, content };
  } catch (error) {
    if(options.signal?.aborted)return {status:"cancelled",url};
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Orvix Live Tool: read_web_page] Failed for ${url}: ${message}`);
    if (searchEntry?.content?.trim()) {
      return {
        status: "partial",
        url,
        title: searchEntry.title,
        source: "search_provider_text",
        content: searchEntry.content.slice(0, 2200),
        message: "The original page could not be opened. This is a search-provider excerpt; label claims from it as unverified by a direct page read.",
      };
    }
    return { status: "unavailable", url, message: "This search result page could not be opened. Try another source." };
  }
}

async function fetchWebpage(input = {}) {
  const url = typeof input === "string" ? input.trim() : (input.url || "").toString().trim();
  console.log(`[Orvix Agent Tool: fetch_webpage] URL: "${url}"`);
  if (!url || !/^https?:\/\//i.test(url)) throw new Error("A valid HTTP or HTTPS URL is required.");

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      throw new Error(`Failed to load page: HTTP ${response.status}`);
    }

    const html = await response.text();
    const finalUrl = response.url || url;
    const pageTitle = decodeHtmlEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<[^>]+>/g, '').trim());
    if (/^(?:404\b|page not found|not found|404.{0,20}not found)/i.test(pageTitle)) {
      return { status: 'not_found', url: finalUrl, requestedUrl: url, title: pageTitle, error: 'The server returned a not-found page. This does not establish that the business does not exist.' };
    }
    if (/^(?:just a moment|access denied|attention required|checking your browser|please verify)/i.test(pageTitle) || /anomaly-modal|cf-chl-/i.test(html)) {
      return { status: 'blocked', url: finalUrl, requestedUrl: url, title: pageTitle, error: 'The page returned an access challenge, not readable business content.' };
    }
    const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].flatMap(match => {
      try {
        const link = new URL(decodeHtmlEntities(match[1]), finalUrl);
        const title = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 150);
        return ['https:', 'http:'].includes(link.protocol) && link.origin === new URL(finalUrl).origin
          && /contact|about|policy|return|refund|deliver|shipping|shop|product|catalog|categor|collection|docs?|documentation|guide|tutorial|architecture|overview|spec(?:ification)?|rfc|benchmarks?|internals|github|release-notes|changelog|reference|components|ecosystem|যোগাযোগ|পণ্য/i.test(link.pathname + ' ' + title) ? [{ url: link.href, title }] : [];
      } catch { return []; }
    }).filter((link, index, all) => all.findIndex(other => other.url === link.url) === index).slice(0, 50);
    // Strip scripts, styles, svg, and html tags
    const cleaned = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
      .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, "")
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, "")
      .replace(/<br\s*[\/]?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/h[1-6]>/gi, "\n\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n+/g, "\n\n")
      .trim();

    const readable = decodeHtmlEntities(cleaned);
    const maxChars = Number.isInteger(input?.limit) ? Math.min(Math.max(2000, input.limit), 50000) : 32000;
    const decoded = readable.slice(0, maxChars);
    return {
      status: decoded ? 'ok' : 'no_readable_content',
      requestedUrl: url,
      url: finalUrl,
      title: pageTitle,
      links,
      length: decoded.length,
      content: decoded,
      truncated: readable.length > decoded.length,
      evidenceScope: 'Observed page text only. Seller statements do not independently verify reviews, rankings, transactions or delivery performance.',
      ...(decoded ? {} : { note: 'The page loaded without readable text. This does not prove information is absent; a rendered browser view may be needed.' }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Orvix Agent Tool: fetch_webpage] ERROR: ${message}`);
    return { status: 'unavailable', url, error: message, note: 'This read failed. Do not infer that the website, business or published information does not exist.' };
  }
}

module.exports = { searchWeb, readSearchResultPage, fetchWebpage, configureSearchKeys };
