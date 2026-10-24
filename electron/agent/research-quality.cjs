const ignored = new Set('best online about search find website websites site official primary buy selling shop store bd bangladesh in the a an and or for of to is what then www com'.split(' '));
const words = value => String(value).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const compact = value => words(value).join('');

function assessSearch(query, results) {
  const terms = [...new Set(words(query).filter(word => word.length > 2 && !ignored.has(word)))];
  const entities = [...String(query).matchAll(/["“]([^"”]+)["”]/g)].map(match => compact(match[1]));
  const domains = [...String(query).matchAll(/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+\.[a-z]{2,}(?:\.[a-z]{2,})?)\b/gi)].map(match => match[1].toLowerCase());
  const assessed = results.map(result => {
    const text = `${result.title} ${result.snippet} ${result.url}`.toLowerCase();
    const tokens = new Set(words(text));
    const matchedTerms = terms.filter(term => tokens.has(term) || term.endsWith('s') && tokens.has(term.slice(0, -1)) || term.length > 4 && text.includes(term));
    const entityMatched = /\bOR\b/.test(query) ? !entities.length || entities.some(entity => compact(text).includes(entity)) : entities.every(entity => compact(text).includes(entity));
    let host = ''; try { host = new URL(result.url).hostname.toLowerCase(); } catch {}
    const domainMatched = !domains.length || domains.some(domain => host === domain || host.endsWith('.' + domain));
    const relevant = entityMatched && domainMatched && (!terms.length || matchedTerms.length > 0);
    const bangladeshRequested = /\b(?:bangladesh|bd)\b|বাংলাদেশ/i.test(query);
    const locationEvidence = !bangladeshRequested ? 'not_requested' : /\bbangladesh\b|বাংলাদেশ/.test(text) || host.endsWith('.bd') ? 'mentioned' : 'not_established';
    return { ...result, relevance: relevant ? 'candidate' : 'low', matchedTerms, locationEvidence,
      evidenceScope: 'Search excerpt only; open the page before attributing detailed facts. Marketing copy is not an independent ranking.' };
  });
  return {
    results: assessed.filter(result => result.relevance !== 'low'),
    rejectedCount: assessed.filter(result => result.relevance === 'low').length,
    candidateUrls: domains.map(domain => `https://${domain}/`),
    note: 'Search coverage is incomplete. A missing match never establishes that a business, website, policy or published information does not exist. Candidate URLs are unverified until fetched. If results miss the named entity, try its official domain or a materially different focused query; do not repeat equivalent searches or infer facts from unrelated hits.',
  };
}

function observedResearchSources(entries, read) {
  return entries.filter(entry => ['web_search', 'fetch_webpage'].includes(entry.name)).slice(-25).flatMap(entry => {
    try {
      let source = read(entry, 0), raw = source.output;
      const failed = source.failed;
      while (source.nextOffset != null && raw.length < 120000) { source = read(entry, source.nextOffset); raw += source.output; }
      const output = JSON.parse(raw);
      const usable = !failed && !output.error && (entry.name === 'web_search'
        ? output.status === 'ok' && output.results?.length > 0
        : (!output.status || output.status === 'ok') && typeof output.content === 'string' && output.content.length > 0);
      const text = entry.name === 'web_search'
        ? (output.results ?? []).map(item => `${item.title}\n${item.url}\n${item.snippet}`).join('\n\n')
        : [output.title, output.url, output.content ?? output.error ?? ''].filter(Boolean).join('\n');
      return [{ evidenceId: entry.id, requestId: entry.requestId, name: entry.name, usable, text: text.slice(0, 35000),
        url: output.url, query: output.query, truncated: output.truncated === true || text.length > 35000 || source.nextOffset != null }];
    } catch { return []; }
  });
}

function sourceExcerpt(source, requested) {
  if (typeof requested !== 'string' || !requested.trim()) return null;
  if (source.includes(requested)) return requested;
  if (requested.length > 6000) return null;
  const pattern = requested.trim().split(/\s+/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return new RegExp(pattern).exec(source)?.[0] ?? null;
}

module.exports = { assessSearch, observedResearchSources, sourceExcerpt };
