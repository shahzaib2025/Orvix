const crypto = require('node:crypto');

// Runs in the preview browser. Return only bounded structural facts, never
// page copy, selectors, file paths, assets or style/theme tokens.
function captureComposition() {
  const box = el => {
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.x / innerWidth * 20) / 20, y: Math.round((b.y + scrollY) / innerHeight * 20) / 20,
      width: Math.round(b.width / innerWidth * 20) / 20, height: Math.round(b.height / innerHeight * 20) / 20 };
  };
  const useful = el => { const b = el.getBoundingClientRect(); return b.width > 20 && b.height > 20 && getComputedStyle(el).display !== 'none'; };
  const main = document.querySelector('main,[role="main"]') || document.body;
  const h1 = main.querySelector('h1');
  const hero = h1?.closest('section,[data-hero],.hero') || h1?.parentElement;
  const media = el => [...el.querySelectorAll('img,svg,canvas,video')].filter(useful).filter(item => {
    const b = item.getBoundingClientRect(); return b.width * b.height > innerWidth * innerHeight * .015;
  }).sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height);
  const kind = el => ({IMG:'image',SVG:'vector',CANVAS:'canvas',VIDEO:'video'}[el?.tagName?.toUpperCase()] || 'content');
  let focal = hero && media(hero)[0];
  // HTML product/interface visuals need not contain an image or canvas.
  if (hero && !focal) {
    let branch = h1;
    const candidates = [];
    while (branch?.parentElement && hero.contains(branch.parentElement)) {
      const siblings = [...branch.parentElement.children].filter(el => el !== branch && useful(el))
        .filter(el => el.getBoundingClientRect().width > innerWidth * .18 && el.getBoundingClientRect().height > innerHeight * .15)
        // A tall paragraph or wrapped CTA group is still the introduction,
        // not the product visual. Inspect outer sibling branches as well.
        .filter(el => !el.matches('p,h1,h2,h3,h4,h5,h6,nav,header,footer,a,button'))
        .filter(el => el.matches('figure,aside,article,table,form,[role="img"]')
          || el.querySelector('figure,aside,article,table,form,[role="img"]')
          || [...el.children].some(child => child.matches('div,section,ol,ul')));
      candidates.push(...siblings);
      if (branch.parentElement === hero) break;
      branch = branch.parentElement;
    }
    focal = candidates.sort((a,b) => b.getBoundingClientRect().width*b.getBoundingClientRect().height-a.getBoundingClientRect().width*a.getBoundingClientRect().height)[0];
  }
  let relationship = 'text-led';
  if (h1 && focal) {
    const a = h1.getBoundingClientRect(), b = focal.getBoundingClientRect();
    relationship = a.right <= b.left + 20 ? 'text-left-media-right' : b.right <= a.left + 20 ? 'media-left-text-right'
      : a.bottom <= b.top + 20 ? 'text-above-media' : b.bottom <= a.top + 20 ? 'media-above-text' : 'overlapping';
  }
  const purpose = section => {
    const text = (section.querySelector('h1,h2')?.textContent || '').toLowerCase();
    if (section.contains(h1)) return 'hero';
    if (/price|pricing|plans|pay for|billing|membership/.test(text)) return 'pricing';
    if (/workflow|process|steps|how it|handoff|on-call path/.test(text)) return 'process';
    if (/integrat|connect|data you|api/.test(text)) return 'integration';
    if (/faq|questions|limits|guardrails/.test(text)) return 'questions';
    if (/collection|projects|portfolio|work index/.test(text)) return 'collection';
    if (section.querySelector('form')) return 'action';
    if (/product|diagnosis|views|case file|capabilit|features|sources/.test(text)) return 'product';
    return 'content';
  };
  const sections = [...main.querySelectorAll('section')].filter(el => !el.parentElement.closest('section')).slice(0, 20).map(section => {
    const groups = [...section.querySelectorAll('*')].slice(0, 150).filter(el => {
      const style = getComputedStyle(el), children = [...el.children].filter(useful);
      return /grid|flex/.test(style.display) && children.length >= 2 && children.length <= 12;
    }).map(el => {
      const children = [...el.children].filter(useful), bounds = children.map(child => child.getBoundingClientRect());
      const rows = new Set(bounds.map(b => Math.round(b.top / 20))).size;
      const columns = new Set(bounds.map(b => Math.round(b.left / 20))).size;
      return { count: children.length, columns, rows, area: el.getBoundingClientRect().width * el.getBoundingClientRect().height };
    }).sort((a,b) => b.area-a.area);
    const group = groups[0];
    return { purpose: purpose(section), layout: !group ? 'flow' : group.columns > 1 ? group.rows > 1 ? 'grid' : 'columns' : 'stack',
      groupCount: group?.count || 0, columns: group?.columns || 1, media: [...new Set(media(section).map(kind))].sort(), ...box(section) };
  });
  return { version: 1, hero: h1 ? { relationship, media: kind(focal), text: box(h1), ...(focal ? { focal: box(focal) } : {}) } : null, sections };
}

const purposes = new Set(['hero','pricing','process','integration','questions','collection','action','product','content']);
const relationships = new Set(['text-led','text-left-media-right','media-left-text-right','text-above-media','media-above-text','overlapping']);
const mediaKinds = new Set(['image','vector','canvas','video','content']);
const layouts = new Set(['flow','grid','columns','stack']);
function cleanComposition(value) {
  if (value?.version !== 1 || !Array.isArray(value.sections)) return null;
  const geometry = item => Object.fromEntries(['x','y','width','height'].map(key => [key, Math.max(-100, Math.min(100, Number(item?.[key]) || 0))]));
  const hero = relationships.has(value.hero?.relationship) ? { relationship:value.hero.relationship,
    media:mediaKinds.has(value.hero.media) ? value.hero.media : 'content', text:geometry(value.hero.text), ...(value.hero.focal ? {focal:geometry(value.hero.focal)} : {}) } : null;
  const sections = value.sections.slice(0,20).map(item => ({purpose:purposes.has(item.purpose)?item.purpose:'content',layout:layouts.has(item.layout)?item.layout:'flow',
    groupCount:Math.max(0,Math.min(12,Number(item.groupCount)||0)),columns:Math.max(1,Math.min(12,Number(item.columns)||1)),
    media:[...new Set((Array.isArray(item.media)?item.media:[]).filter(kind=>mediaKinds.has(kind)))].sort(),...geometry(item)}));
  return hero || sections.length ? {version:1,hero,sections} : null;
}
function observedComposition(views, fingerprint) {
  const widths = new Map();
  for (const view of views || []) {
    const width=Number(view.width || view.metrics?.viewportWidth)||0, composition=cleanComposition(view.metrics?.composition);
    if (composition) widths.set(width,{width,composition});
  }
  const sorted=[...widths.values()].sort((a,b)=>b.width-a.width);
  const rows=sorted.length>1?[sorted[0],sorted.at(-1)]:sorted;
  return rows.length ? {version:1,fingerprint,views:rows} : null;
}
function structuralSignature(view) {
  const composition = cleanComposition(view?.metrics?.composition);
  if (!composition) return null;
  return {...composition, version:2, hash:crypto.createHash('sha256').update(JSON.stringify(composition)).digest('hex')};
}
function structureSimilarity(a,b) {
  if (!a?.hero || !b?.hero || !a.sections?.length || !b.sections?.length) return null;
  const geometry = (left,right) => ['x','width','height'].reduce((sum,key)=>sum+Math.max(0,1-Math.abs((left?.[key]||0)-(right?.[key]||0))/.3),0)/3;
  const hero = (Number(a.hero.relationship===b.hero.relationship)*2 + geometry(a.hero.text,b.hero.text) + Number(a.hero.media===b.hero.media))/4;
  const token = section => [section.purpose,section.layout,section.groupCount,section.columns,section.media.join(',')].join(':');
  const x=a.sections.map(token),y=b.sections.map(token),dp=Array.from({length:x.length+1},()=>Array(y.length+1).fill(0));
  for(let i=1;i<=x.length;i++)for(let j=1;j<=y.length;j++)dp[i][j]=x[i-1]===y[j-1]?dp[i-1][j-1]+1:Math.max(dp[i-1][j],dp[i][j-1]);
  return hero*.45+(2*dp[x.length][y.length]/(x.length+y.length))*.55;
}
function comparisonHints(views, prior) {
  const current = (views ?? []).map(view => ({width:Number(view.width ?? view.metrics?.viewportWidth)||0,composition:cleanComposition(view.metrics?.composition)}))
    .filter(view=>view.composition).sort((a,b)=>b.width-a.width)[0];
  if (!current) return [];
  return (prior ?? []).flatMap(record=>{
    const previous=(record.observedComposition?.views ?? []).map(view=>({width:Number(view.width)||0,composition:cleanComposition(view.composition)}))
      .filter(view=>view.composition).sort((a,b)=>Math.abs(a.width-current.width)-Math.abs(b.width-current.width))[0];
    if (!previous) return [];
    const similarity=structureSimilarity(current.composition,previous.composition);
    if (similarity===null) return [];
    return [{taskId:record.taskId,viewportWidth:current.width,previousViewportWidth:previous.width,
      currentHero:current.composition.hero.relationship,previousHero:previous.composition.hero.relationship,
      similarity:Math.round(similarity*1000)/1000,currentSections:current.composition.sections.length,previousSections:previous.composition.sections.length}];
  }).sort((a,b)=>b.similarity-a.similarity).slice(0,3);
}
module.exports = {captureComposition,cleanComposition,observedComposition,structuralSignature,structureSimilarity,comparisonHints};
