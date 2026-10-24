const {app,session,BrowserWindow}=require('electron');
const path=require('node:path');
// Isolate validation from the user's chats and credentials.
const userData=path.resolve(__dirname,'../scratch/screen-capture-validation-user-data');
require('node:fs').mkdirSync(userData,{recursive:true});
app.setPath('userData',userData);
const fs=require('node:fs'),trace=path.resolve(__dirname,'../scratch/screen-capture-permissions.jsonl');fs.writeFileSync(trace,'');
app.whenReady().then(()=>{
const permission=session.defaultSession.setPermissionRequestHandler.bind(session.defaultSession);session.defaultSession.setPermissionRequestHandler=handler=>permission((wc,name,done,details)=>handler(wc,name,value=>{fs.appendFileSync(trace,JSON.stringify({kind:'permission',name,types:details.mediaTypes,isMainFrame:details.isMainFrame,allowed:value})+'\n');done(value);},details));
const capture=session.defaultSession.setDisplayMediaRequestHandler.bind(session.defaultSession);session.defaultSession.setDisplayMediaRequestHandler=handler=>capture((request,done)=>{fs.appendFileSync(trace,JSON.stringify({kind:'capture',video:request.videoRequested,audio:request.audioRequested,gesture:request.userGesture,mainFrame:BrowserWindow.getAllWindows().some(w=>w.webContents.mainFrame===request.frame&&w.webContents.getURL().endsWith('/index.html'))})+'\n');handler(request,value=>{fs.appendFileSync(trace,JSON.stringify({kind:'grant',allowed:!!value})+'\n');done(value);});});
});
require(path.join(process.argv.find(arg=>arg.endsWith('app.asar')),'electron/main.cjs'));
