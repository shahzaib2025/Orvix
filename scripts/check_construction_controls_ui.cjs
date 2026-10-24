// Real renderer and preload, isolated profile, simulated Windows effects.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require('playwright-core');
const root=path.resolve(__dirname,'..');
async function main(){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-construction-ui-'));let desktop;
  try{
    const env={...process.env,ORVIX_TINY_UI_DIR:directory};delete env.ELECTRON_RUN_AS_NODE;
    desktop=await _electron.launch({executablePath:require('electron'),args:[path.join(__dirname,'check_tiny_agents_ui.cjs')],env,timeout:30000});
    const page=await desktop.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.getByRole('button',{name:'Tiny Agents',exact:true}).click();
    const panel=page.getByRole('region',{name:'Construction Lock',exact:true});await panel.waitFor();
    await page.locator('#startup-splash').waitFor({state:'detached'});
    const configure=values=>desktop.evaluate((_electron,values)=>Object.assign(global.tinyFixture.constructionFixture,values),values);
    await panel.getByRole('button',{name:'Test restriction message',exact:true}).click();await panel.getByText('Test message acknowledged. No permissions changed.',{exact:true}).waitFor();
    await configure({failMessage:true});await panel.getByRole('button',{name:'Test restriction message',exact:true}).click();await panel.getByText('Fixture native message unavailable',{exact:false}).waitFor();await configure({failMessage:false});
    await panel.getByRole('button',{name:'Protect files or folders',exact:true}).click();
    const paths=panel.getByLabel('Construction protected paths');await paths.fill('"C:\\Disposable\\one.txt"\nC:\\Disposable\\one.txt\nC:\\Disposable\\two.txt');
    await panel.getByRole('button',{name:'Remove duplicates',exact:true}).click();assert.equal(await paths.inputValue(),'C:\\Disposable\\one.txt\nC:\\Disposable\\two.txt');
    await panel.getByRole('button',{name:'Remove selected path 2',exact:true}).click();assert.equal(await paths.inputValue(),'C:\\Disposable\\one.txt');
    await panel.getByRole('button',{name:'15 min',exact:true}).click();assert.equal(await panel.getByLabel('Construction duration minutes').inputValue(),'15');
    const check=()=>panel.getByRole('button',{name:'Check selected paths',exact:true}).click();await check();await panel.getByRole('region',{name:'Reviewed protection selection'}).waitFor();
    await panel.getByLabel('Construction duration minutes').fill('10');await panel.getByRole('region',{name:'Reviewed protection selection'}).waitFor({state:'hidden'});assert.equal(await panel.getByRole('button',{name:'Activate Windows protection',exact:true}).count(),0);
    await check();await panel.getByRole('button',{name:'Activate Windows protection',exact:true}).click();await panel.getByText('Windows protection active',{exact:true}).waitFor();assert.equal(await paths.isDisabled(),true);
    assert.equal(await desktop.evaluate(()=>global.tinyFixture.constructionFixture.events.filter(value=>value==='activate').length),1);
    await panel.getByRole('button',{name:'Copy recovery details',exact:true}).click();await panel.getByText('Recovery details copied.',{exact:true}).waitFor();
    await panel.getByRole('button',{name:'Show protected path 1 in Explorer',exact:true}).click();await panel.getByText('Explorer reveal requested.',{exact:true}).waitFor();
    await configure({holdUnlock:true});await panel.getByRole('button',{name:'Unlock now',exact:true}).click();await panel.getByText('Restoring original permissions',{exact:true}).waitFor();assert.equal(await panel.getByText('Access restored and checked',{exact:true}).count(),0);
    await desktop.evaluate(()=>global.tinyFixture.constructionFixture.releaseUnlock());await panel.getByText('Access restored and checked',{exact:true}).waitFor();await configure({holdUnlock:false});assert.equal(await paths.isEnabled(),true);
    await configure({failList:true});await panel.getByRole('button',{name:'Refresh status',exact:true}).click();await panel.getByText('Live status unavailable',{exact:true}).waitFor();assert.equal(await panel.getByRole('button',{name:'Check selected paths',exact:true}).isDisabled(),true);
    await configure({failList:false});await panel.getByRole('button',{name:'Refresh status',exact:true}).click();await panel.getByText('Live status unavailable',{exact:true}).waitFor({state:'hidden'});
    for(const malformed of [true,'attempts','issues']){await configure({malformed});await panel.getByRole('button',{name:'Refresh status',exact:true}).click();await panel.getByText('Live status unavailable',{exact:true}).waitFor();await configure({malformed:false});await panel.getByRole('button',{name:'Refresh status',exact:true}).click();await panel.getByText('Live status unavailable',{exact:true}).waitFor({state:'hidden'});}
    await configure({failAccess:true});await panel.getByRole('button',{name:'Check access',exact:true}).click();await panel.getByText('Permissions restored · access needs attention',{exact:true}).waitFor();assert.equal(await panel.getByText('Access restored and checked',{exact:true}).count(),0);
    await configure({failAccess:false});await panel.getByRole('button',{name:'Check access again',exact:true}).click();await panel.getByText('Access restored and checked',{exact:true}).waitFor();
    await panel.getByRole('button',{name:'Use these paths again',exact:true}).click();await configure({holdActivation:true});await check();await panel.getByRole('button',{name:'Activate Windows protection',exact:true}).click();await panel.getByRole('button',{name:'Cancel activation',exact:true}).waitFor();
    await panel.getByRole('button',{name:'Cancel activation',exact:true}).click();await panel.getByText('Cancellation requested · waiting for Windows acknowledgement',{exact:true}).waitFor();assert.equal(await paths.isDisabled(),true);assert.equal(await panel.getByText('Access restored and checked',{exact:true}).count(),0);
    await desktop.evaluate(()=>global.tinyFixture.constructionFixture.releaseActivation());await panel.getByText('Protection was not activated',{exact:true}).waitFor();await panel.getByRole('button',{name:'Cancel activation',exact:true}).waitFor({state:'hidden'});assert.equal(await paths.isEnabled(),true);
    await configure({holdCancellation:true});await check();await panel.getByRole('button',{name:'Activate Windows protection',exact:true}).click();await panel.getByRole('button',{name:'Cancel activation',exact:true}).click();await panel.getByRole('button',{name:'Requesting cancellation…',exact:true}).waitFor();
    await desktop.evaluate(()=>global.tinyFixture.constructionFixture.releaseActivation());await panel.getByText('Protection was not activated',{exact:true}).waitFor();await panel.getByRole('button',{name:'Requesting cancellation…',exact:true}).waitFor({state:'hidden'});
    await configure({failList:true});await desktop.evaluate(()=>global.tinyFixture.constructionFixture.releaseCancellation());await panel.getByText('Live status unavailable',{exact:true}).waitFor();assert.equal(await panel.getByRole('button',{name:'Cancel activation',exact:true}).count(),0);assert.equal(await paths.isEnabled(),true);await panel.getByText('Protection was not activated',{exact:true}).waitFor();
    await configure({failList:false});await panel.getByRole('button',{name:'Refresh status',exact:true}).click();await panel.getByText('Live status unavailable',{exact:true}).waitFor({state:'hidden'});
    await page.setViewportSize({width:800,height:900});assert.equal(await panel.evaluate(element=>element.scrollWidth>element.clientWidth+1),false);
    await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});const violations=await page.evaluate(async()=>(await window.axe.run('.tiny-construction',{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}})).violations.map(value=>({id:value.id,impact:value.impact})));assert.deepEqual(violations,[]);
    assert.deepEqual(errors,[]);await page.screenshot({path:path.join(root,'scratch','construction-controls.png')});
    console.log('PASS: Construction Lock controls: synthetic message failure visible, quoted path cleanup, removal, presets, scoped review, activation, delayed unlock acknowledgement, malformed status and nested diagnostics, access attention, cancellation acknowledgement, stale cancellation ignored even during status disconnection, compact layout and accessibility. No real permissions changed.');
  }catch(error){if(desktop){const page=desktop.windows()[0];if(page){console.error((await page.locator('body').innerText()).slice(-6000));await page.screenshot({path:path.join(root,'scratch','construction-controls-failure.png')}).catch(()=>{});}}throw error;}
  finally{await desktop?.close();assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('orvix-construction-ui-'));fs.rmSync(directory,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
