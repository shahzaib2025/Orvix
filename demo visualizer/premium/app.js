const canvases = ['orbit', 'veil', 'prism', 'halo', 'facet'].map(id => document.getElementById(id));
const contexts = canvases.map(canvas => canvas.getContext('2d'));
const demoButton = document.getElementById('demo-button');
const micButton = document.getElementById('mic-button');
const status = document.getElementById('signal-status');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let stream;
let audioContext;
let analyser;
let frequencies;
let source = 'demo';
let level = 0;
let lastFrame = 0;

function resize() {
  canvases.forEach(canvas => {
    const side = canvas.getBoundingClientRect().width;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(side * ratio);
    canvas.height = Math.round(side * ratio);
    canvas.getContext('2d').setTransform(ratio, 0, 0, ratio, 0, 0);
  });
}
new ResizeObserver(resize).observe(canvases[0]);
resize();

function setSource(next, label) {
  source = next;
  demoButton.classList.toggle('is-selected', next === 'demo');
  micButton.classList.toggle('is-selected', next === 'mic');
  demoButton.setAttribute('aria-pressed', String(next === 'demo'));
  micButton.setAttribute('aria-pressed', String(next === 'mic'));
  status.innerHTML = `<span class="live-dot"></span> ${label}`;
}
function stopMic() {
  stream?.getTracks().forEach(track => track.stop());
  stream = undefined;
  analyser?.disconnect();
  analyser = undefined;
}
demoButton.addEventListener('click', () => {
  stopMic();
  setSource('demo', 'Previewing motion');
});
micButton.addEventListener('click', async () => {
  if (source === 'mic') {
    stopMic();
    setSource('demo', 'Previewing motion');
    return;
  }
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone unavailable');
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
    await audioContext.resume();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = .78;
    frequencies = new Uint8Array(analyser.frequencyBinCount);
    audioContext.createMediaStreamSource(stream).connect(analyser);
    setSource('mic', 'Microphone active');
  } catch {
    stopMic();
    setSource('demo', 'Microphone unavailable');
  }
});
window.addEventListener('pagehide', stopMic);

function signal(t) {
  if (source === 'mic' && analyser) {
    analyser.getByteFrequencyData(frequencies);
    let sum = 0;
    for (let i = 2; i < 78; i++) sum += frequencies[i];
    return Math.min(1, sum / (76 * 100));
  }
  const beat = Math.pow(Math.max(0, Math.sin(t * 2.4)), 5);
  return .23 + .16 * Math.sin(t * 1.1) ** 2 + .26 * beat + .09 * Math.sin(t * 5.4) ** 2;
}
function clear(ctx, size) { ctx.clearRect(0, 0, size, size); }
function ring(ctx, x, y, r, color, width, from = 0, to = Math.PI * 2) {
  ctx.beginPath(); ctx.arc(x, y, r, from, to); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}
function drawOrbit(ctx, s, t, e) {
  const c = s / 2, r = s * .255;
  clear(ctx, s);
  const glow = ctx.createRadialGradient(c,c,0,c,c,s*.42);
  glow.addColorStop(0,'#8a79e822'); glow.addColorStop(1,'#8a79e800');
  ctx.fillStyle = glow; ctx.fillRect(0,0,s,s);
  ring(ctx,c,c,r,'#b7a6fa24',.8);
  ring(ctx,c,c,r*.72,'#b7a6fa18',.7);
  for(let i=0;i<58;i++){
    const a=i*Math.PI*2/58-Math.PI/2;
    const pulse=.28+.72*Math.pow(Math.sin(i*.43-t*2.6),2);
    const h=2+e*12*pulse;
    const inner=r+5;
    ctx.beginPath();ctx.moveTo(c+Math.cos(a)*inner,c+Math.sin(a)*inner);
    ctx.lineTo(c+Math.cos(a)*(inner+h),c+Math.sin(a)*(inner+h));
    ctx.strokeStyle=`rgba(194,178,255,${.16+.65*pulse})`;ctx.lineWidth=1.3;ctx.lineCap='round';ctx.stroke();
  }
  ring(ctx,c,c,r,'#cabaff',1.6,t*.42,t*.42+Math.PI*.8);
  const a=t*.42+Math.PI*.8;
  ctx.shadowBlur=13;ctx.shadowColor='#b49bff';ctx.fillStyle='#eee7ff';ctx.beginPath();ctx.arc(c+Math.cos(a)*r,c+Math.sin(a)*r,2.8,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
  ctx.fillStyle='#dcd5ff';ctx.beginPath();ctx.arc(c,c,2.1+e*2,0,Math.PI*2);ctx.fill();
}
function drawVeil(ctx, s, t, e) {
  const c=s/2; clear(ctx,s);
  const glow=ctx.createRadialGradient(c,c,0,c,c,s*.4);
  glow.addColorStop(0,'#88b8df2c');glow.addColorStop(1,'#88b8df00');ctx.fillStyle=glow;ctx.fillRect(0,0,s,s);
  for(let layer=0;layer<4;layer++){
    ctx.beginPath();
    for(let i=0;i<=100;i++){
      const x=s*.17+i*s*.66/100;
      const envelope=Math.sin(Math.PI*i/100)**1.7;
      const wave=Math.sin(i*.117-t*(1.1+layer*.11)+layer*.65)*Math.cos(i*.052+t*.53);
      const y=c+(layer-1.5)*4+wave*envelope*(8+e*18);
      if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
    }
    ctx.strokeStyle=['#8ac4e456','#9fd2efaa','#c0e6ff','#99b5fa7a'][layer];
    ctx.lineWidth=layer===2?1.5:1;ctx.lineCap='round';ctx.shadowBlur=layer===2?10:0;ctx.shadowColor='#89c9ed';ctx.stroke();
  }
  ctx.shadowBlur=0;
  ring(ctx,c,c,s*.285,'#aac8e71c',.7,-Math.PI*.12,Math.PI*1.12);
  ctx.fillStyle='#c8e9ff';ctx.beginPath();ctx.arc(c,c,1.8,0,Math.PI*2);ctx.fill();
}
function drawPrism(ctx,s,t,e){
  const c=s/2;clear(ctx,s);
  const glow=ctx.createRadialGradient(c,c,0,c,c,s*.42);glow.addColorStop(0,'#d49fcb20');glow.addColorStop(1,'#d49fcb00');ctx.fillStyle=glow;ctx.fillRect(0,0,s,s);
  const count=31, gap=s*.018, width=s*.009;
  for(let i=0;i<count;i++){
    const x=c+(i-(count-1)/2)*gap;
    const falloff=Math.sin(Math.PI*(i+.5)/count)**1.9;
    const variation=.42+.58*Math.sin(i*.42-t*2.4)**2;
    const h=4+falloff*(13+e*29)*variation;
    const grad=ctx.createLinearGradient(0,c-h,0,c+h);
    grad.addColorStop(0,'#bba9f9');grad.addColorStop(.5,'#f0c7e6');grad.addColorStop(1,'#958ae1');
    ctx.fillStyle=grad;ctx.globalAlpha=.4+.6*falloff;ctx.beginPath();ctx.roundRect(x-width/2,c-h/2,width,h,width/2);ctx.fill();
  }
  ctx.globalAlpha=1;
  ring(ctx,c,c,s*.295,'#d4b5db22',.8);
  ring(ctx,c,c,s*.295,'#e1bbec88',1,-Math.PI*.7+t*.14,-Math.PI*.35+t*.14);
}
function drawHalo(ctx,s,t,e){
  const c=s/2;clear(ctx,s);
  const glow=ctx.createRadialGradient(c,c,0,c,c,s*.44);glow.addColorStop(0,'#8cddbd2b');glow.addColorStop(1,'#8cddbd00');ctx.fillStyle=glow;ctx.fillRect(0,0,s,s);
  for(let layer=0;layer<3;layer++){
    ctx.beginPath();
    for(let i=0;i<=128;i++){
      const a=i*Math.PI*2/128;
      const ripple=Math.sin(a*5-t*(1.3+layer*.2)+layer)*e*5+Math.sin(a*3+t*.65+layer)*1.5;
      const r=s*(.18+layer*.057)+ripple;
      const x=c+Math.cos(a)*r,y=c+Math.sin(a)*r;
      if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
    }
    ctx.closePath();ctx.strokeStyle=['#8dd5bb45','#a1e2ccbb','#d1fae6a3'][layer];ctx.lineWidth=layer===1?1.5:1;ctx.shadowBlur=layer===1?12:0;ctx.shadowColor='#90dbbe';ctx.stroke();
  }
  ctx.shadowBlur=0;
  ctx.fillStyle='#c9f3e3';ctx.beginPath();ctx.arc(c,c,2.4+e*2.5,0,Math.PI*2);ctx.fill();
}
function drawFacet(ctx,s,t,e){
  const c=s/2;clear(ctx,s);
  const glow=ctx.createRadialGradient(c,c,0,c,c,s*.42);glow.addColorStop(0,'#e9bd8327');glow.addColorStop(1,'#e9bd8300');ctx.fillStyle=glow;ctx.fillRect(0,0,s,s);
  const sides=8,base=s*.235;
  for(let layer=2;layer>=0;layer--){
    const r=base*(1-layer*.23)+e*(7-layer*1.5);
    ctx.beginPath();
    for(let i=0;i<sides;i++){
      const a=(i/sides)*Math.PI*2-Math.PI/2+t*(layer===0?.08:-.045);
      const rr=r+(i%2===0?e*4:0);
      const x=c+Math.cos(a)*rr,y=c+Math.sin(a)*rr;
      if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
    }
    ctx.closePath();ctx.strokeStyle=['#f0d7ae',' #e9bd8399','#e9bd8340'][layer].trim();ctx.lineWidth=layer===0?1.35:.8;ctx.stroke();
  }
  for(let i=0;i<8;i++){
    const a=i*Math.PI/4-Math.PI/2+t*.08;
    const inner=base*.78,outer=base*1.15+e*9;
    ctx.beginPath();ctx.moveTo(c+Math.cos(a)*inner,c+Math.sin(a)*inner);ctx.lineTo(c+Math.cos(a)*outer,c+Math.sin(a)*outer);
    ctx.strokeStyle=`rgba(247,215,171,${.16+e*.28})`;ctx.lineWidth=.8;ctx.stroke();
  }
  ctx.fillStyle='#f8e5c5';ctx.beginPath();ctx.arc(c,c,2.2,0,Math.PI*2);ctx.fill();
}
function frame(ms) {
  if (reducedMotion.matches && ms-lastFrame < 180) { requestAnimationFrame(frame); return; }
  lastFrame=ms;
  const t=reducedMotion.matches?0:ms/1000;
  level += (signal(t)-level)*.12;
  contexts.forEach((ctx,i)=>{
    const s=canvases[i].getBoundingClientRect().width;
    if(i===0)drawOrbit(ctx,s,t,level);
    if(i===1)drawVeil(ctx,s,t,level);
    if(i===2)drawPrism(ctx,s,t,level);
    if(i===3)drawHalo(ctx,s,t,level);
    if(i===4)drawFacet(ctx,s,t,level);
  });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
