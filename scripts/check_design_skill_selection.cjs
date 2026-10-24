const test=require('node:test'),assert=require('node:assert/strict');
const skills=require('../electron/agent/skill-library.cjs');
const {createTools}=require('../electron/agent/tools.cjs');
const {createContextManager}=require('../electron/agent/context-manager.cjs');
const {profileGuidance}=require('../electron/agent/design-profile.cjs');
const {designExecutionInstructions}=require('../electron/agent/design-review.cjs');
const ids={normal:'website_design',medium:'website_design_medium',max:'website_design_max'};

test('subject-led hero instructions reach MAX through managed reads without changing other profile skills',()=>{
 const direct=skills.selectedSkill('website_design','max');
 assert.match(direct.instructions,/Give the hero a subject-led composition/);
 assert.match(direct.instructions,/one dominant visual anchor/);
 assert.match(direct.instructions,/Neither a full-bleed image nor a centered or split arrangement is a required replacement template/);
 assert.match(direct.instructions,/do not reuse a description contradicted by the image/);
 assert.match(direct.instructions,/Do not seek or automatically attach previous project screenshots/);
 assert.match(direct.instructions,/do not add a mandatory hero checkpoint, extra screenshot stage or approval/);
 const nativeFile=skills.selectedSkills({native:true,designProfile:'max'}).find(x=>x.id==='website_design_max').path;
 assert.equal(skills.nativeSkill(nativeFile,'max').instructions,direct.instructions);
 for(const profile of ['normal','medium'])assert.doesNotMatch(skills.selectedSkill('website_design',profile).instructions,/Give the hero a subject-led composition/);
 assert.deepEqual(skills.selectedSkills({designProfile:'none'}).filter(x=>x.designProfile||x.forDesignProfile),[]);
});
test('all design profiles share the two-brief layout-first method through direct and native reads',()=>{
 const guide=skills.selectedSkill('visual_composition','normal');
 assert.match(guide.instructions,/Layout first for a new whole website/);
 assert.match(guide.instructions,/two concise internal design briefs/);
 assert.match(guide.instructions,/document source in a logical reading order/);
 for(const profile of ['normal','medium','max']){
  const selected=skills.selectedSkill('website_design',profile);
  assert.match(selected.instructions,/layout-first procedure in visual_composition/);
  assert.match(selected.instructions,/storyboard before source construction/);
  assert.match(designExecutionInstructions('Create a new website','Full access',profile),/set_design_brief.storyboard before source construction/);
  assert.match(designExecutionInstructions('Create a new website','Full access',profile),/two short spatial options A and B and a selection reason/);
  const guidePath=skills.selectedSkills({native:true,designProfile:profile}).find(entry=>entry.id==='visual_composition').path;
  const native=skills.nativeSkill(guidePath,profile);
  assert.equal(native.contentHash,guide.contentHash);
 }
});

test('observable alternatives retain scope and comparison judges only the selected plan',()=>{
 const {compositionEvidenceInstructions}=require('../electron/agent/design-diversity.cjs');
 const {renderComparisonInstructions,compactBrief}=require('../electron/agent/design-comparison.cjs');
 for(const prompt of [compositionEvidenceInstructions,renderComparisonInstructions])assert.match(prompt,/judge only the selected plan/);
 const guide=skills.selectedSkill('visual_composition','normal').instructions;
 assert.match(guide,/selected plan first/);assert.match(guide,/labeled A and B/);
 assert.match(guide,/not private reasoning transcripts/);assert.match(guide,/3,000-character storyboard limit/);
 assert.doesNotMatch(guide,/Record only the selected direction/);
 const selected='Selected B: A full-width headline above the primary action; small artwork along the bottom edge.';
 assert.ok(compactBrief({storyboard:selected+'\n'+'x'.repeat(2000)+'\nAlternatives: A unused; B selected.'}).storyboard.startsWith(selected));
 for(const request of ['Repair the existing website','Recreate this exact website reference'])
  assert.doesNotMatch(designExecutionInstructions(request,'Full access','normal'),/two short spatial options/);
 assert.equal(designExecutionInstructions('Create a new website','Full access','none'),'');
});
test('MAX Windows delivery requires a project-owned preview launcher without changing other profiles',()=>{
 const max=skills.selectedSkill('website_design','max').instructions;
 assert.match(max,/Start-Preview\.bat/);assert.match(max,/short \*\*README\.md\*\*/);
 assert.match(max,/cd \/d "%~dp0"/);assert.match(max,/support spaces in the folder name/);
 assert.match(max,/existing supported development\/preview command/);
 assert.match(max,/project-owned static-server helper/);assert.match(max,/Serve over HTTP/);
 assert.match(max,/available browser-safe port/);assert.match(max,/only after that server is ready/);
 assert.match(max,/keep the error window open/);assert.match(max,/Ctrl\+C/);
 assert.match(max,/does not expand a component-only change or unrelated repair/);
 for(const profile of ['normal','medium'])assert.doesNotMatch(skills.selectedSkill('website_design',profile).instructions,/Start-Preview\.bat|Windows preview delivery/);
 assert.deepEqual(skills.selectedSkills({designProfile:'none'}).filter(entry=>entry.designProfile||entry.forDesignProfile),[]);
 const file=skills.selectedSkills({native:true,designProfile:'max'}).find(entry=>entry.id==='website_design_max').path;
 const native=skills.nativeSkill(file,'max');assert.equal(native.contentHash,skills.selectedSkill('website_design','max').contentHash);
 assert.ok(skills.completeNativeRead(native,native.instructions));
});
for(const [profile,id] of Object.entries(ids)){
 test(`${profile} advertises and loads only its selected website skill on direct and native routes`,async()=>{
  for(const native of [false,true]){
   const catalog=skills.selectedSkills({native,designProfile:profile});
   assert.deepEqual(catalog.filter(x=>x.designProfile).map(x=>x.id),[id]);
   const prompt=skills.skillCatalogPrompt({native,designProfile:profile});
   for(const other of Object.values(ids))if(other!==id)assert.ok(!prompt.includes('"id":"'+other+'"'));
   if(native)for(const entry of skills.listSkills(true).filter(x=>x.designProfile))assert.equal(skills.nativeSkill(entry.path,profile)?.id??null,entry.id===id?id:null);
  }
  const blocked=new Proxy({}, {get(){throw Error('No workspace access needed');}});
  const tools=createTools(blocked,blocked,blocked,'test',new AbortController().signal,()=>false,null,null,null,null,null,null,null,'Plan',{designProfile:()=>profile});
  const alias=JSON.parse(await tools.call('read_agent_skill',{id:'website_design'}));
  const exact=JSON.parse(await tools.call('read_agent_skill',{id}));
  assert.equal(alias.id,id);assert.equal(exact.id,id);
  const source=skills.readSkill(id);
  assert.equal(alias.instructions,source.instructions);assert.equal(exact.instructions,source.instructions);
  assert.equal(alias.contentHash,source.contentHash);assert.equal(exact.contentHash,source.contentHash);
  for(const other of Object.values(ids))if(other!==id&&other!=='website_design')await assert.rejects(tools.call('read_agent_skill',{id:other}),/not available/);
  if(profile!=='normal')assert.equal(profileGuidance(profile),skills.readSkill(id).instructions);
 });
 test(`${profile} excludes other profile instructions from restored context`,()=>{
  const restored={activeSkills:Object.values(ids).map(id=>({...skills.readSkill(id),evidenceId:'proof-'+id}))};
  const context=createContextManager([],[],restored,()=>'',{designProfile:profile});
  assert.deepEqual(context.loadedSkills().map(x=>x.id),[id]);
  const wrong=Object.values(ids).find(x=>x!==id);
  assert.throws(()=>context.recordSkill(skills.readSkill(wrong),'other-proof'),/selected design profile/);
 });
}

test('MAX motion contract is loaded through both managed routes, with scope and optional 3D preserved',async()=>{
 const max=skills.selectedSkill('website_design','max');
 assert.match(max.instructions,/at least nine meaningful content sections/);
 assert.match(max.instructions,/at least four distinct SVG story treatments/);
 assert.match(max.instructions,/across the hero, early, middle and late page/);
 assert.match(max.instructions,/multiple subject-relevant SVG elements/);
 assert.match(max.instructions,/restrained seamless accent on a meaningful word or short phrase/);
 assert.match(max.instructions,/spatial relationship chosen for this subject/);
 assert.match(max.instructions,/artwork itself must change after entrance/);
 assert.match(max.instructions,/GSAP, ScrollTrigger and Lenis together/);
 const motion=skills.selectedSkill('website_motion_max','max');
 const gsap=skills.selectedSkill('gsap','max').instructions;
 const lenis=skills.selectedSkill('lenis','max').instructions;
 const svg=skills.selectedSkill('gsap_svg','max').instructions;
 const typography=skills.selectedSkill('gsap_text','max').instructions;
 assert.match(motion.instructions,/Read `gsap`, `scrolltrigger`, and `lenis`/);
 assert.match(lenis,/one named callback on GSAP's ticker/);
 assert.match(gsap,/Avoid infinite child loops/);
 assert.match(gsap,/one clear animation owner/);
 assert.match(typography,/Reserve space for changing text/);
 assert.match(motion.instructions,/serve ES modules over HTTP/);
 assert.match(motion.instructions,/script or asset fails.*useful page and controls must remain/);
 assert.match(gsap,/fromTo/);
 assert.match(motion.instructions,/reverse scroll, re-entry, and refresh/);
 assert.match(max.instructions,/Two substantial pinned storytelling scenes with different purposes/);
 assert.match(max.instructions,/connected visual story through four or five adjacent meaningful sections/);
 for(const plugin of ['Flip', 'DrawSVG', 'MorphSVG'])assert.ok(svg.includes(plugin),plugin);
 for(const plugin of ['SplitText', 'ScrambleText', 'TextPlugin'])assert.ok(typography.includes(plugin),plugin);
 assert.match(max.instructions,/Footer navigation does not count/);
 assert.doesNotMatch(max.instructions,/Include one substantial pinned storytelling scene by default/);
 assert.match(motion.instructions,/story stages and controls/);
 assert.match(max.instructions,/explicitly requested by the human or the existing 3d-website option/);
 assert.doesNotMatch(max.instructions,/Do not introduce a mandatory animation package/);
 const nativePath=skills.selectedSkills({native:true,designProfile:'max'}).find(s=>s.id===max.id).path;
 assert.equal(skills.nativeSkill(nativePath,'max').contentHash,max.contentHash);
 assert.ok(skills.completeNativeRead(max,max.instructions));
 for(const native of [false,true])assert.match(skills.skillCatalogPrompt({native,designProfile:'max'}),/3D is explicitly requested or the existing 3d-website option is selected/);
 for(const profile of ['normal','medium'])assert.doesNotMatch(skills.selectedSkill('website_design',profile).instructions,/at least nine meaningful content sections|one shared GSAP ticker|two substantial pinned storytelling scenes|connected visual story across four or five|at least four distinct SVG story treatments/);
 const full=designExecutionInstructions('Create a full professional website','Full access','max');
 assert.match(full,/nine meaningful content sections/);assert.match(full,/GSAP \+ ScrollTrigger \+ Lenis/);assert.match(full,/Three\.js requires an explicit request/);
 assert.match(full,/selected skill owns the full-page depth and motion requirements/);
 assert.doesNotMatch(full,/two distinct pinned scenes|four or five sections|layered SVG hero with seamless visual\/keyword loops/);
 const twenty=designExecutionInstructions('Create a 20-section website with Three.js','Full access','max');
 assert.match(twenty,/explicit counts/i);
 for(const request of ['Create a static website','Create only one website section','Create a pixel-perfect website recreation','Improve this existing website form','Create an admin dashboard','Create a bounded three-section website composition study, not a full website']){
  const scoped=designExecutionInstructions(request,'Full access','max');
  assert.doesNotMatch(scoped,/use at least nine|GSAP \+ ScrollTrigger \+ Lenis/);
  assert.match(scoped,/requested scope|bounded, static or application work/);
 }
 assert.equal(designExecutionInstructions('Research only, do not implement a website','Full access','max'),'');
 assert.equal(designExecutionInstructions('Create a website','Plan','max'),'');
});

test('MAX implementation reference is on-demand, protected, and excluded from other profiles and restored context',async()=>{
 const id='website_motion_max',reference=skills.selectedSkill(id,'max');
 for(const profile of ['normal','medium']){
  assert.ok(!skills.selectedSkills({designProfile:profile}).some(s=>s.id===id));
  assert.throws(()=>skills.selectedSkill(id,profile),/not available/);
  assert.equal(skills.nativeSkill(skills.selectedSkills({native:true,designProfile:'max'}).find(s=>s.id===id).path,profile),null);
  const context=createContextManager([],[],{activeSkills:[{...reference,evidenceId:'reference-proof'}]},()=>'',{designProfile:profile});
  assert.deepEqual(context.loadedSkills(),[]);
 }
 const blocked=new Proxy({}, {get(){throw Error('No workspace access needed');}});
 const tools=createTools(blocked,blocked,blocked,'test',new AbortController().signal,()=>false,null,null,null,null,null,null,null,'Plan',{designProfile:()=> 'max'});
 assert.equal(JSON.parse(await tools.call('read_agent_skill',{id})).contentHash,reference.contentHash);
 const native=skills.nativeSkill(skills.selectedSkills({native:true,designProfile:'max'}).find(s=>s.id===id).path,'max');
 assert.equal(native.contentHash,reference.contentHash);assert.ok(skills.completeNativeRead(native,reference.instructions));
 assert.match(skills.selectedSkill('lenis','max').instructions,/remove the exact named GSAP ticker callback.*before destroying/);
});
