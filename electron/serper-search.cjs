let store = null;
function configureSearchKeys(value) { store = value; }
function getSearchKeys() { return store; }
async function searchSerper(query, freshness, fetcher = fetch, signal, type = 'search') {
  if (!['search', 'images'].includes(type)) throw new Error('Unsupported Serper search type.');
  if (!store) throw new Error('No Serper keys configured.');
  const attempted = new Set();
  const limit = store.snapshot().keys.length;
  while (attempted.size < limit) {
    signal?.throwIfAborted();
    const reservation = store.reserve(attempted);
    if (!reservation) throw new Error('No usable Serper credits, or provider is cooling down.');
    attempted.add(reservation.keyId);
    let response;
    try {
      const times = { oneDay: 'qdr:d', oneWeek: 'qdr:w', oneMonth: 'qdr:m', oneYear: 'qdr:y' };
      response = await fetcher('https://google.serper.dev/' + type, {
        method: 'POST', headers: { 'X-API-KEY': reservation.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, hl: 'en', gl: 'us', num: 10, ...(times[freshness] ? { tbs: times[freshness] } : {}) }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000),
      });
    } catch {
      store.settle(reservation.id, 'unknown');
      throw new Error('Serper request outcome unknown.');
    }
    let body;
    try { body = await response.json(); }
    catch {
      store.settle(reservation.id, response.ok ? 'unknown' : 'failure', { message: 'Serper returned an unreadable response.' });
      throw new Error('Serper returned an unreadable response.');
    }
    if (!response.ok) {
      const message = typeof body?.message === 'string' ? body.message : typeof body?.error === 'string' ? body.error : '';
      const exhausted = /credits?|balance/i.test(message) && /insufficient|not enough|no remaining|out of|exhausted|depleted|zero|limit (?:exceeded|reached)/i.test(message);
      const invalid = response.status === 401 || /invalid.*(?:api.?key|credential)|unauthorized/i.test(message);
      if (response.status === 429) {
        const header = response.headers?.get('retry-after');
        const retry = Number(header) || (header ? (Date.parse(header) - Date.now()) / 1000 : 0);
        store.settle(reservation.id, 'failure', { message: 'Serper rate limit; provider cooling down.', cooldownMs: Number.isFinite(retry) && retry > 0 ? Math.min(retry * 1000, 3600000) : 60000 });
        throw new Error('Serper rate limit; provider cooling down.');
      }
      store.settle(reservation.id, exhausted ? 'exhausted' : invalid ? 'invalid' : response.status >= 500 ? 'unknown' : 'failure', { message: exhausted ? 'Serper account credits exhausted.' : invalid ? 'Serper key rejected.' : `Serper HTTP ${response.status}.` });
      if (exhausted || invalid) continue;
      throw new Error(`Serper HTTP ${response.status}.`);
    }
    store.settle(reservation.id, 'success', { credits: body?.credits });
    if (type === 'images') {
      const publicUrl = value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !require('node:net').isIP(url.hostname) && !/(^localhost$|\.localhost$|\.local$)/i.test(url.hostname) ? url.href : null; } catch { return null; } };
      const seen = new Set();
      return (Array.isArray(body?.images) ? body.images : []).flatMap(item => {
        const url=publicUrl(item.imageUrl),sourcePage=publicUrl(item.link),thumbnailUrl=publicUrl(item.thumbnailUrl);
        if(!url||!sourcePage||seen.has(url))return [];seen.add(url);
        return [{title:String(item.title??'').slice(0,200),url,sourcePage,thumbnailUrl,width:Number(item.imageWidth)||null,height:Number(item.imageHeight)||null,source:String(item.source??'').slice(0,200),license:'Not verified; inspect original source before reuse'}];
      }).slice(0,4);
    }
    if (!Array.isArray(body?.organic)) return [];
    const seen = new Set();
    return body.organic.flatMap(result => {
      let url; try { url = new URL(result.link); } catch { return []; }
      if (url.protocol !== 'https:' || url.username || url.password) return [];
      for (const key of [...url.searchParams.keys()]) if (/^utm_|^(gclid|_gl|ref|authuser)$/i.test(key)) url.searchParams.delete(key);
      url.hash = '';
      if (seen.has(url.href)) return []; seen.add(url.href);
      return [{ title: String(result.title || '').slice(0, 200), snippet: String(result.snippet || '').slice(0, 1500), url: url.href, ...(result.date ? { date: String(result.date), datePublished: String(result.date) } : {}) }];
    });
  }
  throw new Error('No usable Serper keys remain for this search.');
}
module.exports = { configureSearchKeys, getSearchKeys, searchSerper };
