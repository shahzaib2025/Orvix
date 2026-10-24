// Pure selection shared by normal navigation and YouTube. No page text executes.
const OrvixTabRouting = (() => {
  function site(value) {
    try { const u=new URL(value); if(!['http:','https:'].includes(u.protocol))return ''; return ['youtube.com','www.youtube.com'].includes(u.hostname)?'youtube.com':u.hostname; } catch {return '';}
  }
  function sameUrl(a,b) {try {const x=new URL(a),y=new URL(b);x.hash='';y.hash='';return x.href===y.href;}catch{return false;}}
  function choose(state,url,windowId) {
    const tabs=state.tabs.filter(t=>!t.incognito&&site(t.url)===site(url)&&(!windowId||t.windowId===windowId));
    const exact=tabs.filter(t=>sameUrl(t.url,url));
    const candidates=exact.length?exact:tabs;
    const focused=state.windows.find(w=>w.focused)?.id;
    const active=tabs.find(t=>t.active&&t.windowId===focused);
    const chosen=active||[...candidates].sort((a,b)=>(b.lastAccessed||0)-(a.lastAccessed||0)||a.id-b.id)[0];
    return chosen?{tab:chosen,reason:active?'active_matching_tab':exact.length?'recent_exact_url':'recent_matching_site'}:null;
  }
  return {site,sameUrl,choose};
})();
if(typeof module!=='undefined')module.exports=OrvixTabRouting;
