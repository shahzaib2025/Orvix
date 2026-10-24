const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-message-nav-'));
  const bundle = await require('esbuild').build({
    stdin: {
      contents: `
        import { useRef, useState } from 'react'; import { createRoot } from 'react-dom/client';
        import AgentMessageNavigator from './src/components/AgentMessageNavigator';
        import { useAgentAutoScroll } from './src/components/useAgentAutoScroll';
        function Fixture() {
          const scrollRef = useRef(null); const contentRef = useRef(null);
          const [session, setSession] = useState('first'); const [growth, setGrowth] = useState(0); const [threadVisible, setThreadVisible] = useState(false);
          const messages = session === 'first' ? [
            {id:'a',prompt:'Keep the composer background transparent',reply:'The composer background and border now stay transparent.'},
            {id:'b',prompt:'Build a website for Florian BD',reply:'The website includes responsive layouts and working navigation.'},
            {id:'c',prompt:'Research the best plant nursery',reply:'Research is in progress.'}
          ] : [{id:'new-a',prompt:'A different session',reply:'Only this session appears here.'},{id:'new-b',prompt:'Second request',reply:'Another reply.'}];
          const {jumpToMessage,jumpToLatest,showJumpToLatest} = useAgentAutoScroll(scrollRef,contentRef,session,threadVisible);
          return <><button onClick={()=>setGrowth(value=>value+600)}>Stream more</button><button onClick={()=>setSession('second')}>Switch session</button>
            <button onClick={()=>{setThreadVisible(false);setGrowth(0)}}>Start empty task</button><button onClick={()=>setThreadVisible(true)}>Show first message</button>
            {threadVisible&&<div className="viewport"><div className="scroll" ref={scrollRef}><div ref={contentRef}>
              {messages.map((message,index)=><article key={message.id} data-agent-message-id={message.id} style={{height:450+(index===messages.length-1?growth:0)}}><p className="prompt">{message.prompt}</p><p>{message.reply}</p></article>)}
            </div></div><AgentMessageNavigator key={session} scrollRef={scrollRef} messages={messages} onNavigate={jumpToMessage}/>
            {showJumpToLatest&&<button className="latest" onClick={jumpToLatest}>Jump to latest</button>}</div>}</>;
        }
        createRoot(document.getElementById('root')).render(<Fixture/>);
      `, resolveDir: path.join(__dirname, '..'), loader: 'tsx',
    }, bundle: true, write: false, outfile: path.join(root, 'fixture.js'), jsx: 'automatic', format: 'iife',
    platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' },
  });
  const javascript = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', request.url === '/fixture.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/fixture.js' ? javascript : `<!doctype html><html><head><style>
      body{margin:24px;background:#191a1b;color:#eee;font:14px Arial}.viewport{position:relative;width:100%;height:500px;margin:20px auto}.scroll{height:100%;overflow:auto;scrollbar-width:none;overflow-anchor:none}.scroll::-webkit-scrollbar{display:none}article{box-sizing:border-box;padding:20px 70px;margin:0}p{margin:0 0 40px}.prompt{padding:15px;background:#28292b;border-radius:16px;margin-left:auto;width:60%}.latest{position:absolute;bottom:10px;right:10px}${css}
    </style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const executablePath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(file => fs.existsSync(file));
    browser = await require('playwright-core').chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, reducedMotion: 'no-preference' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('button',{name:'Show first message',exact:true}).click();
    await page.locator('.scroll').waitFor();
    await page.waitForFunction(()=>{const el=document.querySelector('.scroll');return el.scrollTop===el.scrollHeight-el.clientHeight;});
    const nav = page.getByRole('navigation', { name: 'Messages in this conversation' });
    const markers = nav.getByRole('button');
    await nav.waitFor(); assert.equal(await markers.count(),3);
    assert.equal(await page.getByRole('scrollbar').count(),0,'the incorrect scrollbar implementation is removed');
    await markers.nth(0).hover();
    const preview = page.getByRole('tooltip');
    assert.match(await preview.innerText(),/Keep the composer background transparent/);
    assert.match(await preview.innerText(),/background and border now stay transparent/);
    const screenshotPath = path.join(__dirname,'..','scratch','agent-message-navigation','preview.png');
    fs.mkdirSync(path.dirname(screenshotPath),{recursive:true}); await page.screenshot({path:screenshotPath});
    await markers.nth(0).click();
    await page.waitForFunction(()=>document.querySelector('.scroll').scrollTop===0);
    await page.getByRole('button',{name:'Stream more',exact:true}).click();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
    assert.equal(await page.locator('.scroll').evaluate(el=>el.scrollTop),0,'streaming must not pull the reader away from an older message');
    await page.getByRole('button',{name:'Jump to latest',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.scroll').scrollTop===document.querySelector('.scroll').scrollHeight-document.querySelector('.scroll').clientHeight);
    await markers.nth(0).focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.querySelector('.scroll').scrollTop>=430&&document.querySelector('.scroll').scrollTop<=450);
    await page.keyboard.press('Escape'); assert.equal(await preview.count(),0);
    await page.getByRole('button',{name:'Switch session',exact:true}).click();
    assert.equal(await markers.count(),2); await markers.nth(0).hover();
    assert.match(await preview.innerText(),/A different session/); assert.doesNotMatch(await preview.innerText(),/Florian|composer/);
    await page.getByRole('button',{name:'Start empty task',exact:true}).click();
    assert.equal(await page.locator('.scroll').count(),0);
    await page.getByRole('button',{name:'Show first message',exact:true}).click();
    await page.locator('.scroll').waitFor();
    await page.getByRole('button',{name:'Stream more',exact:true}).click();
    await page.waitForFunction(()=>{const el=document.querySelector('.scroll');return el.scrollTop===el.scrollHeight-el.clientHeight;});
    await page.locator('.scroll').hover();
    await page.mouse.wheel(0,-20);
    await page.waitForFunction(()=>{const el=document.querySelector('.scroll');const distance=el.scrollHeight-el.clientHeight-el.scrollTop;return distance>0&&distance<=42;});
    assert.equal(await page.getByRole('button',{name:'Jump to latest',exact:true}).count(),0,'a small upward movement near the bottom must keep following');
    await page.mouse.wheel(0,-40);
    await page.waitForFunction(()=>{const el=document.querySelector('.scroll');return el.scrollHeight-el.clientHeight-el.scrollTop>42;});
    await page.getByRole('button',{name:'Jump to latest',exact:true}).waitFor();
    await page.getByRole('button',{name:'Jump to latest',exact:true}).click();
    await page.waitForFunction(()=>{const el=document.querySelector('.scroll');return el.scrollTop===el.scrollHeight-el.clientHeight;});
    await page.mouse.wheel(0,40);
    await page.locator('.scroll').evaluate(el=>{el.scrollTop-=100;});
    await page.waitForFunction(()=>{const el=document.querySelector('.scroll');return el.scrollHeight-el.clientHeight-el.scrollTop>42;});
    assert.equal(await page.getByRole('button',{name:'Jump to latest',exact:true}).count(),0,'a downward gesture must not misclassify unrelated upward movement as user intent');
    await page.getByRole('button',{name:'Stream more',exact:true}).click();
    await page.waitForFunction(()=>{const el=document.querySelector('.scroll');return el.scrollTop===el.scrollHeight-el.clientHeight;});
    await page.setViewportSize({width:650,height:700}); assert.equal(await nav.isVisible(),false);
    assert.deepEqual(errors,[]);
    console.log('PASS: per-message markers preview the correct prompt/reply, jump by click and keyboard, preserve reading position when detached, attach after an empty thread mounts, follow live growth, preserve near-bottom following, reset across sessions, and hide on narrow screens.');
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(root,{recursive:true,force:true});
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
