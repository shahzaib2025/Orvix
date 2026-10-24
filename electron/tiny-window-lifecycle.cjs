function handleTinyWindowClose(event, {allowQuit, control, stopVoice, hide, quit, notify}) {
    if(allowQuit)return;
    event.preventDefault();stopVoice();
    if(control?.backgroundEnabled===true){hide();if(control.status==='running')notify();}
    else quit();
}
async function stopTinyRuntimeAndUnlock(runtime,protection) {
    const [control,listing]=await Promise.all([runtime.control({action:'stop'}),protection?.unlock()]);
    if(listing?.lock&&!['unlocked','failed','access_unverified'].includes(listing.lock.status))throw new Error('Agent execution stopped, but file access needs attention. Review Construction Lock before closing.');
    return control;
}
module.exports={handleTinyWindowClose,stopTinyRuntimeAndUnlock};
