// Keep the native inventory for exact-handle operations; expose separate
// application lists so a notification window is never described as an app.
function applicationWindow(window) {
  return !!String(window.title||'').trim() && !/^(?:DWMNotificationWindow|Default IME|MSCTFIME UI|Program Manager|Windows Input Experience)$/i.test(String(window.title)) && !/^(?:dwm|sihost|textinputhost)$/i.test(String(window.app));
}
function annotateWindows(result,previous) {
  if(!Array.isArray(result?.observation?.windows))return result;
  const observation=result.observation,apps=observation.windows.filter(applicationWindow);
  const visible=apps.filter(w=>!/^minimized$/i.test(String(w.state)));
  const key=w=>`${w.handle || String(w.ref||'').split(':').at(-1)}:${w.title}`;
  const old=previous?.windows?.filter(applicationWindow);
  const comparison=old ? {previousAt:previous.timestamp,currentAt:observation.timestamp,
    added:apps.filter(w=>!old.some(p=>key(p)===key(w))).map(w=>w.title),
    removed:old.filter(w=>!apps.some(p=>key(p)===key(w))).map(w=>w.title),
    unchanged:apps.filter(w=>old.some(p=>key(p)===key(w))).map(w=>w.title)} : {available:false,reason:'No earlier native window observation is retained in this session.'};
  return {...result,observation:{...observation,applicationWindows:apps,visibleApplicationWindows:visible,comparison,
    inventoryScope:'Native application inventory; minimized windows are open but not shown. Non-minimized windows may overlap or be occluded.'}};
}
function windowActionResult(result) {
  const verified=result.verified===true;
  const checkedFailure=['focus','minimize','maximize'].includes(result.action) && result.verified===false;
  return {...result,status:result.completionUnknown ? 'dispatched' : verified ? 'ok' : checkedFailure ? 'failed' : result.ok ? 'ok' : 'failed',
    verification:{verified,evidence:verified?'Requested window state independently observed.':checkedFailure?'Requested window state was checked and did not match.':'Window request unconfirmed; inspect its state.'}};
}
module.exports={applicationWindow,annotateWindows,windowActionResult};
