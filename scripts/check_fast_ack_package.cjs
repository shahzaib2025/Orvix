// Smoke-test the actual production renderer inside the Windows package.
// No normal executable startup, login-setting changes, microphone or Live API.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const asar=require('@electron/asar'),{chromium}=require('playwright-core');
const root=path.join(__dirname,'..'),archive=path.join(root,'scratch/fast-ack-package/win-unpacked/resources/app.asar');
const files=asar.listPackage(archive).map(name=>name.replace(/\\/g,'/').replace(/^\//,''));
const report={scope:'Windows package contents and actual bundled renderer in headless Chromium. Normal Orvix.exe startup, IPC, physical audio and microphone latency remain unverified.',errors:[]};
const server=http.createServer((req,res)=>{
  const name=req.url.split('?')[0]==='/'?'dist/index.html':'dist'+req.url.split('?')[0];
  if(!files.includes(name)){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':'text/html');
  res.end(asar.extractFile(archive,path.normalize(name)));
});
(async()=>{let browser;
 try{
  assert.ok(fs.existsSync(path.join(path.dirname(path.dirname(archive)),'Orvix.exe')));
  const renderer=files.filter(name=>/^dist\/assets\/index-.*\.js$/.test(name)).map(name=>asar.extractFile(archive,path.normalize(name)).toString()).join('\n');
  assert.ok(renderer.includes('Acknowledgment playback drained'),'package must include the candidate controller');
  assert.ok(renderer.includes('normally 4-6 words'),'package must include the concise generation prompt');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({channel:'chromium',headless:true});const page=await browser.newPage();
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(()=>document.getElementById('root')?.children.length>0);
  assert.deepEqual(report.errors,[]);report.rendererPassed=true;report.currentControllerIncluded=true;
  await page.screenshot({path:path.join(root,'scratch/fast-ack-package-renderer.png')});
  console.log(JSON.stringify(report));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(root,'scratch/fast-ack-package.report.json'),JSON.stringify(report,null,2));}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
