// Only a source explicitly chosen in the main workspace can be captured.
function installScreenSharing({session,ipcMain,desktopCapturer,getMainWindow,setPetCaptureExcluded=()=>false,getPetCaptureGuard=()=>null,compositionDelayMs=200}) {
  let offered=new Set(),offeredAt=0,selection=null,protection=null;
  const watched=new WeakSet();
  let offeredSources=new Map();
  const release=(notify=false)=>{const prior=protection;protection=null;if(prior){if(notify&&!prior.owner.isDestroyed?.())prior.owner.send?.('orvix:screen-capture-stopped');setPetCaptureExcluded(false);}};
  const main=()=>{const w=getMainWindow();return w&&!w.isDestroyed()?w:null;};
  const authorize=event=>{const w=main();if(!w||event.sender!==w.webContents||event.senderFrame!==w.webContents.mainFrame)throw Error('Screen sharing is available only in the main workspace.');return w;};
  ipcMain.handle('orvix:screen-pet-exclusion',async(event,active,lease)=>{
    const w=authorize(event);
    if(typeof active!=='boolean')throw Error('Invalid capture exclusion request.');
    if(!active){if(typeof lease!=='string')throw Error('Invalid capture lease.');if(protection?.lease===lease)release();return null;}
    if(!selection||selection.owner!==w.webContents||selection.expires<Date.now())throw Error('Choose a screen before starting capture.');
    release();
    const token=require('node:crypto').randomUUID();
    protection={owner:w.webContents,lease:token};
    try{
      const source=offeredSources.get(selection.id);
      protection.source=source;
      if(!setPetCaptureExcluded(true)&&!getPetCaptureGuard(source))throw Error('The pet could not be excluded from this view. Choose a full screen to use pet masking.');
      if(!watched.has(w)){
        watched.add(w);
        const cleanup=()=>{if(protection?.owner===w.webContents){selection=null;release(true);}};
        w.on('hide',cleanup);w.on('closed',cleanup);
        w.webContents.on('render-process-gone',cleanup);w.webContents.on('destroyed',cleanup);
        w.webContents.on('did-start-navigation',(_event,_url,_inPlace,isMainFrame)=>{if(isMainFrame)cleanup();});
      }
      // Windows applies display affinity on a subsequent desktop composition.
      await new Promise(resolve=>setTimeout(resolve,compositionDelayMs));
      if(main()!==w||protection?.lease!==token)throw Error('Screen sharing was stopped.');
      return token;
    }catch(error){if(protection?.lease===token)release();throw error;}
  });
  ipcMain.handle('orvix:screen-capture-guard',(event,lease)=>{
    const w=authorize(event);
    if(!protection||protection.owner!==w.webContents||protection.lease!==lease)throw Error('Screen sharing is no longer active.');
    const guard=getPetCaptureGuard(protection.source);
    if(!guard)throw Error('The pet could not be excluded. Screen sharing has stopped.');
    return guard;
  });
  ipcMain.handle('orvix:screen-sources',async event=>{
    const w=authorize(event);selection=null;
    const sources=await desktopCapturer.getSources({types:['screen','window'],thumbnailSize:{width:360,height:210},fetchWindowIcons:false});
    if(main()!==w)throw Error('Workspace closed.');
    const available=sources.filter(s=>s.name!=='Orvix Pet');
    offeredSources=new Map(available.map(s=>[s.id,s]));
    offered=new Set(available.map(s=>s.id));offeredAt=Date.now();
    return available.map(s=>({id:s.id,name:s.name,kind:s.id.startsWith('screen:')?'screen':'window',thumbnail:s.thumbnail.toDataURL()}));
  });
  ipcMain.handle('orvix:screen-select',(event,id)=>{
    const w=authorize(event);selection=null;
    if(id===null)return;
    if(typeof id!=='string'||Date.now()-offeredAt>120000||!offered.has(id))throw Error('Choose an available screen or window.');
    selection={id,owner:w.webContents,expires:Date.now()+10000};offered.clear();
  });
  session.setDisplayMediaRequestHandler(async(request,callback)=>{
    const deny=()=>{try{callback(null);}catch{/* Requesting frame was destroyed. */}};
    const chosen=selection;const w=main();
    if(!w||!chosen||chosen.owner!==w.webContents||chosen.expires<Date.now()||protection?.owner!==w.webContents||request.frame!==w.webContents.mainFrame||!request.videoRequested||request.audioRequested){deny();return;}
    selection=null;
    try{
      const sources=await desktopCapturer.getSources({types:['screen','window'],thumbnailSize:{width:0,height:0}});
      const source=sources.find(s=>s.id===chosen.id);
      if(main()!==w||protection?.owner!==w.webContents||request.frame!==w.webContents.mainFrame||!source){release();deny();return;}
      callback({video:source});
    }catch{release();deny();}
  });
  return {
    canGrantDisplayMediaPermission:(webContents,details)=>{
      const w=main();
      return !!(w&&webContents===w.webContents&&details.isMainFrame===true&&selection?.owner===webContents&&selection.expires>Date.now()&&protection?.owner===webContents);
    },
    dispose:()=>{selection=null;release(true);},
  };
}
module.exports={installScreenSharing};
