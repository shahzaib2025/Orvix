const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createNotifications } = require('../electron/notifications.cjs');
function fixture({ failLoad = false } = {}) {
  const windows = [], reports = [], opened = [], cancelled = [], timers = new Map(); let time = 10000, sequence = 0;
  const ipc = new EventEmitter(); ipc.handle = (name, callback) => { ipc[name] = callback; };
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.webContents = new EventEmitter(); this.webContents.mainFrame = {}; this.webContents.setWindowOpenHandler = () => {}; this.webContents.send = (channel, notice) => { if(channel==='orvix:notice-update') this.lastNotice = notice; }; windows.push(this); }
    setBounds(bounds) { this.bounds = bounds; }
    loadFile() { return failLoad ? Promise.reject(new Error('missing file')) : Promise.resolve(); }
    showInactive() { this.visible = true; }
    isVisible() { return !!this.visible; }
    hide() { this.visible = false; }
    isDestroyed() { return !!this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const center = createNotifications({ BrowserWindow: Window, ipcMain: ipc, now: () => time,
    screen: { getCursorScreenPoint: () => ({x:10,y:10}), getDisplayNearestPoint: () => ({workArea:{x:0,y:0,width:1920,height:1080}}) },
    onStatus: item => reports.push(item), onOpen: item => opened.push(item), onCancelShutdown: id => cancelled.push(id),
    setTimer: (fn, ms) => { timers.set(++sequence, { fn, at: time + ms }); return sequence; }, clearTimer: id => timers.delete(id) });
  const event = window => ({sender:window.webContents,senderFrame:window.webContents.mainFrame});
  const data = window => ipc['orvix:notice-data'](event(window));
  const emit = (name, window, ...args) => { const n=data(window); ipc.emit(name, event(window), ...args, n?.id, n?.attempt); };
  const display = window => { emit('orvix:notice-loaded', window); emit('orvix:notice-ready', window); emit('orvix:notice-displayed', window); };
  const advance = ms => { time+=ms; for(const [id,timer] of [...timers]) if(timer.at<=time && timers.has(id)) { timers.delete(id); timer.fn(); } };
  return { center, windows, reports, opened, cancelled, ipc, emit, display, timers, event, data, advance };
}
test('preparation is not confirmation; only the visible matching frame acknowledges display', () => {
  const f=fixture(); try {
    const result=f.center.notify('Battery','Now at 80%',{ruleId:'battery'}), w=f.windows[0];
    assert.equal(result.status,'queued'); assert.equal(f.ipc['orvix:notice-data']({sender:{}}),null);
    assert.equal(w.options.webPreferences.sandbox,true);
    f.emit('orvix:notice-ready',w); assert.equal(w.visible,true); assert.equal(f.reports.filter(r=>r.status==='shown').length,0);
    const n=f.data(w);
    f.ipc.emit('orvix:notice-displayed',{sender:w.webContents,senderFrame:{}},n.id,n.attempt);
    assert.equal(f.reports.filter(r=>r.status==='shown').length,0);
    f.emit('orvix:notice-displayed',w); f.emit('orvix:notice-displayed',w);
    assert.equal(f.reports.filter(r=>r.status==='shown').length,1);
    f.emit('orvix:notice-action',w,'open'); assert.equal(f.opened[0].ruleId,'battery'); assert.equal(w.visible,false);
  } finally {f.center.stop();}
});
test('bursts queue unconfirmed cards and respect the confirmed minimum visibility time', () => {
  const f=fixture(); try {
    const ids=[]; for(let i=0;i<6;i++) ids.push(f.center.notify('Normal '+i,'Body').id);
    assert.equal(f.windows.length,3); assert.equal(f.reports.filter(r=>r.status==='superseded').length,0);
    for(const w of f.windows) f.display(w);
    f.advance(1499); assert.equal(f.reports.filter(r=>r.status==='superseded').length,0);
    f.advance(1); assert.equal(f.reports.filter(r=>r.status==='superseded').length,3);
    for(const w of f.windows) f.display(w);
    assert.ok(ids.every(id=>f.reports.some(r=>r.id===id&&r.status==='shown')));
  } finally {f.center.stop();}
});
test('load and renderer failures report unconfirmed attempts and release their windows', async () => {
  const f=fixture({failLoad:true}); try {f.center.notify('Test','Body');await new Promise(r=>setImmediate(r));assert.ok(f.reports.some(r=>r.status==='failed'&&r.message.includes('missing file')));assert.equal(f.windows[0].destroyed,true);} finally {f.center.stop();}
  const g=fixture(); try {g.center.notify('Test','Body');g.windows[0].webContents.emit('render-process-gone');assert.equal(g.reports.filter(r=>r.status==='failed').length,1);} finally {g.center.stop();}
});
test('hover pauses expiry and shutdown cancellation binds its target', () => {
  const f=fixture();try {
    f.center.notify('Normal','Body');const w=f.windows[0];f.display(w);
    f.emit('orvix:notice-action',w,'pause');assert.equal(f.timers.size,0);f.emit('orvix:notice-action',w,'resume');assert.equal(f.timers.size,1);
    f.center.notify('Shutdown','Body',{kind:'shutdown',ruleId:'r',endsAt:40000});const shutdown=f.windows[1];f.display(shutdown);
    f.emit('orvix:notice-action',shutdown,'cancel_shutdown');assert.deepEqual(f.cancelled,['r']);assert.equal(shutdown.visible,false);
  }finally{f.center.stop();}
});
test('same delivery ID with a new attempt rejects stale ready, displayed and action acknowledgements', () => {
  const f=fixture();try {
    f.center.notify('First','Body',{id:'stable',attempt:'old'});const w=f.windows[0];f.emit('orvix:notice-loaded',w);f.center.cancel('stable','old');
    f.center.notify('Retry','Body',{id:'stable',attempt:'new'});
    f.ipc.emit('orvix:notice-ready',f.event(w),'stable','old');f.ipc.emit('orvix:notice-displayed',f.event(w),'stable','old');f.ipc.emit('orvix:notice-action',f.event(w),'dismiss','stable','old');
    assert.equal(w.visible,false);assert.equal(f.data(w).attempt,'new');f.display(w);assert.equal(w.visible,true);assert.equal(f.windows.length,1);
  }finally{f.center.stop();}
});
test('display timeout and unexpected close are failures; cancellation removes queued attempts', () => {
  const f=fixture();try {
    const n=f.center.notify('Timed out','Body');f.advance(5000);assert.ok(f.reports.some(r=>r.id===n.id&&r.status==='failed'));
    const close=f.center.notify('Close','Body');f.windows[0].destroy();assert.ok(f.reports.some(r=>r.id===close.id&&r.status==='failed'));
    const ids=[];for(let i=0;i<4;i++)ids.push(f.center.notify('Q','B').id);f.center.cancel(ids[3]);for(const w of f.windows)if(!w.destroyed)f.display(w);f.advance(1500);assert.ok(!f.reports.some(r=>r.id===ids[3]&&r.status==='preparing'));
  }finally{f.center.stop();}
});
