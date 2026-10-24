// Serialized into the page. Bounded current-state diagnostics, not a visual critic.
function inspectReadableContent() {
  const failures = [], skipped = [], restores = [], tolerance = 1.5;
  const label = element => element.id ? '#' + element.id : element.tagName.toLowerCase() + (element.classList[0] ? '.' + element.classList[0] : '');
  const skip = (element,reason) => { if(skipped.length<12&&!skipped.some(row=>row.element===label(element)&&row.reason===reason)) skipped.push({element:label(element),reason}); };
  const cssCache = new Map(), css = element => { if (!cssCache.has(element)) cssCache.set(element,getComputedStyle(element)); return cssCache.get(element); };
  const visible = (element, paintOnly = false) => {
    for (let node=element;node;node=node.parentElement) {
      const style=css(node);
      if ((!paintOnly&&node.getAttribute('aria-hidden')==='true') || style.display==='none' || style.visibility!=='visible' || Number(style.opacity)<.98) return false;
    }
    return true;
  };
  const transient = element => {
    for (let node=element;node;node=node.parentElement) {
      if (node.getAnimations?.().some(animation => animation.playState==='running' && animation.effect?.getTiming().iterations!==Infinity)) return true;
    }
    return false;
  };
  const context=document.createElement('canvas').getContext('2d');
  if (!context) return {status:'unavailable',reason:'Text metrics unavailable',failures:[]};
  const targets=[...document.querySelectorAll('h1,h2,h3,p,button,a[role="button"],main a,section a,label,[data-fit-essential]')].filter(element => {
    const r=element.getBoundingClientRect();
    return r.width && r.height && r.bottom>0 && r.top<innerHeight && r.right>0 && r.left<innerWidth && visible(element);
  }).slice(0,32);
  // Hit-testing normally ignores pointer-events:none scenery, even when opaque.
  // Enable only hit-testing during this synchronous measurement and restore every
  // inline declaration (including priority) before screenshots or user actions.
  const candidates=[...document.querySelectorAll('body *')].filter(element=>element.namespaceURI==='http://www.w3.org/1999/xhtml'||element.localName==='svg').slice(0,2500).filter(element => {
    const r=element.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom<=0 || r.top>=innerHeight || r.right<=0 || r.left>=innerWidth || !visible(element,true)) return false;
    return targets.some(target => {
      const t=target.getBoundingClientRect();return r.right>t.left&&r.left<t.right&&r.bottom>t.top&&r.top<t.bottom;
    });
  }).slice(0,500);
  try {
    for (const element of candidates) if (css(element).pointerEvents==='none') {
      restores.push([element,element.getAttribute('style')]);
      element.style.setProperty('pointer-events','auto','important');
    }
    for (const target of targets) {
      if (transient(target)) { skip(target,'active animation/transition'); continue; }
      const walker=document.createTreeWalker(target,NodeFilter.SHOW_TEXT); let node, words=0, clip=null, covered=null;
      while ((node=walker.nextNode()) && words<24) {
        const parent=node.parentElement, style=css(parent);
        if (!visible(parent) || style.writingMode!=='horizontal-tb') continue;
        for (const match of node.textContent.matchAll(/\S+/g)) {
          if (++words>24) break;
          const range=document.createRange();range.setStart(node,match.index);range.setEnd(node,match.index+match[0].length);
          if(range.getClientRects().length!==1) {skip(target,'wrapped/mixed-direction word geometry');continue;}
          const rect=range.getBoundingClientRect();
          if (!rect.width || !rect.height || rect.bottom<=0 || rect.top>=innerHeight || rect.right<=0 || rect.left>=innerWidth) continue;
          let transformed=false;
          for(let ancestor=parent;ancestor;ancestor=ancestor.parentElement) {
            const transform=css(ancestor).transform;
            if(transform!=='none') {
              const m=new DOMMatrixReadOnly(transform);
              if(!m.is2D||Math.abs(m.b)>.001||Math.abs(m.c)>.001||m.a<=0||m.d<=0) transformed=true;
            }
          }
          // Rotated/perspective text requires screenshot inspection; an axis-
          // aligned rectangle is not trustworthy ink geometry for that text.
          if (transformed) { skip(target,'rotated/perspective text'); continue; }
          const text=style.textTransform==='uppercase'?match[0].toUpperCase():style.textTransform==='lowercase'?match[0].toLowerCase():match[0];
          context.font=`${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          const metrics=context.measureText(text), fontHeight=metrics.fontBoundingBoxAscent+metrics.fontBoundingBoxDescent;
          if (!fontHeight || !Number.isFinite(metrics.actualBoundingBoxAscent)) { skip(target,'text ink metrics unavailable'); continue; }
          const scale=rect.height/fontHeight, baseline=rect.top+metrics.fontBoundingBoxAscent*scale;
          const inkTop=baseline-metrics.actualBoundingBoxAscent*scale, inkBottom=baseline+metrics.actualBoundingBoxDescent*scale;
          let top=-Infinity,bottom=Infinity,left=-Infinity,right=Infinity;
          for(let ancestor=parent;ancestor&&ancestor!==document.body;ancestor=ancestor.parentElement) {
            const s=css(ancestor),r=ancestor.getBoundingClientRect();
            if(/^(auto|scroll)$/.test(s.overflowY)&&ancestor.scrollHeight>ancestor.clientHeight+2) break;
            const scaleY=ancestor.offsetHeight?r.height/ancestor.offsetHeight:1,scaleX=ancestor.offsetWidth?r.width/ancestor.offsetWidth:1;
            if(/^(hidden|clip)$/.test(s.overflowY)) {top=Math.max(top,r.top+ancestor.clientTop*scaleY);bottom=Math.min(bottom,r.top+(ancestor.clientTop+ancestor.clientHeight)*scaleY);}
            if(/^(hidden|clip)$/.test(s.overflowX)) {left=Math.max(left,r.left+ancestor.clientLeft*scaleX);right=Math.min(right,r.left+(ancestor.clientLeft+ancestor.clientWidth)*scaleX);}
          }
          if (!clip && ((inkTop<top-tolerance&&inkBottom>top)||(inkBottom>bottom+tolerance&&inkTop<bottom))) {
            clip={kind:'text_mask_clipping',element:label(target),word:text.slice(0,60),clippedAbove:Math.max(0,Math.round(top-inkTop)),clippedBelow:Math.max(0,Math.round(inkBottom-bottom))};
          }
          const y=(inkTop+inkBottom)/2;
          if (y<Math.max(0,top)||y>Math.min(innerHeight,bottom)) continue;
          const blockers=[];
          for(const fraction of [.25,.5,.75]) {
            const x=rect.left+rect.width*fraction;
            if(x<Math.max(0,left)||x>Math.min(innerWidth,right)) continue;
            const stack=document.elementsFromPoint(x,y);
            const blocker=stack.find(element => {
              if(element===target||target.contains(element)||element.contains(target)) return false;
              // Stop at the text's own painted layer; content behind it is safe.
              const targetIndex=stack.findIndex(item=>item===parent||parent.contains(item)||item===target);
              if(targetIndex>=0&&stack.indexOf(element)>targetIndex) return false;
              const s=css(element),color=s.backgroundColor,alpha=/rgba\([^)]*,\s*([\d.]+)\)$/.exec(color);
              const opaque=color!=='transparent'&&(!alpha||Number(alpha[1])>=.9);
              return visible(element,true)&&(opaque||s.backgroundImage!=='none'||element.matches('img,video,canvas,svg'));
            });
            if(blocker) blockers.push(blocker);
          }
          if (!covered && blockers.length>=2) covered={kind:'text_occluded',element:label(target),word:text.slice(0,60),by:label(blockers[0])};
          if(clip&&covered) break;
        }
      }
      if (clip) failures.push(clip);
      if (covered) failures.push(covered);
      if(failures.length>=12) break;
    }
  } finally {
    for(const [element,inlineStyle] of restores.reverse()) {
      // Flush a pending CSSOM serialization before removing an originally absent
      // attribute; otherwise Chromium can recreate an empty style attribute.
      element.getAttribute('style');
      if(inlineStyle===null) element.removeAttribute('style'); else element.setAttribute('style',inlineStyle);
    }
  }
  return {failures,skipped:skipped.slice(0,12),targets:targets.length,limitation:'Bounded current-view ink/opaque-layer checks. Finite animations, rotated/perspective text, subtle transparency, unobserved scroll states and subjective quality still require the existing screenshot inspection.'};
}
function readableContentFailures(view) {
  return [...(view.metrics?.readableContent?.status==='unavailable'?[{state:'viewport',kind:'readable_content_unavailable',reason:view.metrics.readableContent.reason}]:[]),
    ...(view.metrics?.readableContent?.failures??[]).map(row=>({state:'viewport',...row})),
    ...(view.motion?.frames??[]).flatMap(frame=>[
      ...(frame.observations?.readableContent?.status==='unavailable'?[{state:frame.label,progress:frame.progress,kind:'readable_content_unavailable',reason:frame.observations.readableContent.reason}]:[]),
      ...(frame.observations?.readableContent?.failures??[]).map(row=>({state:frame.label,progress:frame.progress,...row}))])].slice(0,12);
}
module.exports={inspectReadableContent,readableContentFailures};
