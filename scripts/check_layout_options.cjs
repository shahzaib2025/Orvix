const test=require('node:test'),assert=require('node:assert/strict');
const skills=require('../electron/agent/skill-library.cjs');
const {selectTaskSkills}=require('../electron/agent/task-skill-router.cjs');
const {createSkillPolicy}=require('../electron/agent/skill-policy.cjs');
const {createDesignReview,designExecutionInstructions}=require('../electron/agent/design-review.cjs');
const selected=(request,profile)=>selectTaskSkills(request,{designProfile:profile,policy:createSkillPolicy(profile,request)}).map(s=>s.id);

test('layout-options skill reaches new site, standalone hero and planning requests in each active profile',()=>{
 for(const profile of ['normal','medium','max'])for(const request of ['Create a new premium website for a pottery studio.','Create a new standalone website hero for a bakery.','Develop two website layout options only. Do not build a website.']){
  assert.ok(selected(request,profile).includes('website_layout_options'),profile+': '+request);
  const entry=skills.selectedSkills({native:true,designProfile:profile}).find(s=>s.id==='website_layout_options');
  assert.equal(skills.nativeSkill(entry.path,profile).contentHash,skills.readSkill(entry.id).contentHash);
 }
});
test('None and preservation requests do not automatically load the options workflow',()=>{
 for(const request of ['Create a new premium website.','Develop two website layout options only.']){
  assert.ok(!selected(request,'none').includes('website_layout_options'));
 }
 for(const request of ['Fix the existing website navigation.','Recreate this exact website reference.','Add a contact section to the existing website.','Review the current website design.','Explain this example: "Use website_layout_options"']){
  assert.ok(!selected(request,'max').includes('website_layout_options'),request);
 }
 const request='Use website_layout_options to propose two website concepts only.';
 assert.ok(selected(request,'none').includes('website_layout_options'));
});
test('planning-only options do not load browser or implementation-check workflows',()=>{
 const ids=selected('Develop two website layout options only. Choose one and give the blueprint. Do not build a website.','max');
 assert.ok(ids.includes('website_layout_options'));
 for(const id of ['change_review','project_testing','browser_verification'])assert.ok(!ids.includes(id),id);
 assert.ok(selected('Create a new premium website.','max').includes('browser_verification'));
 assert.ok(selected('Create a new website with pricing options. Use only local assets.','max').includes('browser_verification'));
});
test('natural options-and-plan restrictions exclude prohibited work without suppressing authorized follow-ons',()=>{
 const planningRequests=[
  'Develop two website layout options for a studio. Make a premium full website. Provide options and plan only in chat; do not create a website, inspect project files, use tools or install anything.',
  'Propose two landing page concepts. Do not create a website.',
  'Develop two standalone hero concepts and a plan only in chat. Do not create project files.',
  'Develop two website concepts. dont code yet.',
  'Propose two website options. Don’t create a new website.',
  'Develop two website concepts only. Do not test the existing website.'
 ];
 for(const profile of ['normal','medium','max','none'])for(const request of planningRequests){
  const ids=selected(request,profile);
  for(const id of ['change_review','project_testing','browser_verification'])assert.ok(!ids.includes(id),profile+': '+request+' loaded '+id);
  if(profile!=='none'){
   assert.ok(ids.includes('website_layout_options'),profile+': '+request);
   assert.ok(ids.includes(profile==='max'?'website_design_max':profile==='medium'?'website_design_medium':'website_design'),profile+': selected profile missing');
  }
 }
 for(const request of [
  'Develop two website layout options first, then build the selected website.',
  'Develop website layout options only and test the existing website in a browser.',
  'Create a website with pricing options. Do not create duplicate assets.',
  'Build a new standalone hero section for a product.'
 ]){
  const ids=selected(request,'max');
  assert.ok(ids.includes('browser_verification'),request);
  assert.ok(ids.includes('project_testing'),request);
 }
 const unrelated=selected('Develop two hero concepts for a fantasy novel.','max');
 assert.ok(!unrelated.includes('website_layout_options'));
 assert.ok(!unrelated.includes('website_design_max'));
});
test('skill separates balanced options, selected blueprint and compact construction digest without requiring a template',()=>{
 const text=skills.readSkill('website_layout_options').instructions;
 for(const pattern of [/comparable conviction/,/central idea/,/first-screen composition/i,/one meaningful interaction/i,/cause-and-effect moment/,/page rhythm and visual material/i,/main trade-off and mobile shift/i,/Selected layout blueprint/,/planning-only request ends/,/do not create website files/i,/First 1,500 characters/,/3,000-character limit/,/reverse-scroll behavior/,/Unknown business details remain unknown/,/menu of templates/,/not a rigid worksheet/,/compact enough to scan and compare inside Orvix's existing cards/,/opening sentence of \*\*Selection reason\*\*/,/Do not emit a separate structural-difference paragraph/,/supporting page-wide motion coverage/,/Do not use numerical scores/])assert.match(text,pattern);
 assert.doesNotMatch(text,/100% consistent/i);
 assert.doesNotMatch(text,/always.*(?:left|right|centered|serif|orange)/i);
 const shared=skills.readSkill('visual_composition').instructions;
 assert.match(shared,/registered website_layout_options skill/);
 assert.doesNotMatch(shared,/A sentence per option is enough/);
});

test('automatic preconstruction flow records and publishes options before allowing source creation with review off',async()=>{
 for(const profile of ['normal','medium','max']){
  const events=[];
  const design=createDesignReview({enabled:true,profile,mode:'off',brief:'Create a new website for a pottery studio.',
   evidence:{record:()=>({id:'options-evidence'})},emit:event=>events.push(event),signal:new AbortController().signal});
  assert.throws(()=>design.assertConstruction('write_file',{path:'index.html',content:'<main></main>'}),/website_layout_options/);
  assert.match(designExecutionInstructions('Create a new website','Full access',profile),/first follow website_layout_options/);
  const result=await design.setBrief({audience:'Pottery buyers',primary_action:'Browse vessels',direction:'Object-led ceramic study',signature:'Clay surface narrative',responsive:'Artwork above readable copy and action',
   storyboard:'SELECTED — Option B: an oversized vessel above its caption and purchase action; supporting sections explain material and making.\nOption A — not for construction: a full-width studio photograph with the action along its lower edge.\nOption B — selected: object-led spatial study with a material-detail narrative.\nSelection reason: B puts the object and material evidence first. Mobile stacks the object, caption and action.'});
  assert.equal(result.construction_allowed,true);
  assert.ok(events.some(event=>event.progressId==='website-design-options'&&event.text.includes('Option A')&&event.text.includes('Option B')));
  assert.doesNotThrow(()=>design.assertConstruction('write_file',{path:'index.html',content:'<main></main>'}));
 }
 const fs=require('node:fs'),path=require('node:path');
 const native=fs.readFileSync(path.join(__dirname,'../electron/agent/opencode-agent.cjs'),'utf8');
 assert.match(native,/first follow website_layout_options to develop and compare two credible directions/);
});
