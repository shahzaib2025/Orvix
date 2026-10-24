// Real bundled OpenCode, loopback inference fixture: genuine coding tools remain
// permission-gated; readOnly execution rejection is tested in check_design_review.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {createOpenCodeHeadless}=require('../electron/agent/opencode-headless.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-review-native-')),captured=[];
const server=http.createServer(async(request,response)=>{
 let raw='';for await(const chunk of request)raw+=chunk;
 const body=JSON.parse(raw);captured.push({tools:body.tools?.map(t=>t.function?.name)??[],messages:body.messages?.filter(m=>m.role==='system').map(m=>m.content)});
 response.writeHead(200,{'content-type':'text/event-stream'});
 const base={id:'fixture',object:'chat.completion.chunk',created:1,model:body.model};
 response.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content:'{"status":"distinct","summary":"Fixture evidence only"}'},finish_reason:null}]})+'\n\n');
 response.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\n');response.end('data: [DONE]\n\n');
});
const runtime=createOpenCodeHeadless(root,{buildTemperature:null});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 await runtime.exclusive(AbortSignal.timeout(90000),async({api})=>{
  await api('/global/config',{method:'PATCH',body:{provider:{opencode:{options:{baseURL:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'loopback-only'},models:{'review-fixture':{name:'Review fixture',temperature:true,tool_call:true,reasoning:false,cost:{input:0,output:0},limit:{context:32000,output:1000},provider:{npm:'@ai-sdk/openai-compatible'}}}}}}});
  const agents=await api('/agent'),agent=agents.find(a=>a.name==='orvix_review');
  assert.ok(agent);assert.equal(agent.temperature??null,null);assert.match(agent.prompt,/evidence-only analysis step/);assert.ok(agent.permission.some(r=>r.permission==='*'&&r.action==='ask'));
  const session=await api('/session',{method:'POST',body:{permission:[{permission:'*',pattern:'*',action:'ask'}]}});
  try{
   await api(`/session/${session.id}/prompt_async`,{method:'POST',timeoutMs:15000,body:{model:{providerID:'opencode',modelID:'review-fixture'},agent:'orvix_review',parts:[{type:'text',text:'Return JSON only. No tools.'}]}});
   let reply;for(let i=0;i<100;i++){
    reply=(await api(`/session/${session.id}/message`)).findLast(m=>m.info?.role==='assistant');
    if(reply?.info?.time?.completed||reply?.info?.error)break;
    await new Promise(resolve=>setTimeout(resolve,200));
   }
   assert.ok(reply);assert.equal(reply.info?.error,undefined,JSON.stringify(reply.info?.error));
   assert.equal(captured.length,1);assert.ok(captured[0].tools.includes('bash'),'Keep genuine native tool catalog and permission gates');
   assert.ok(captured[0].messages.some(m=>String(m).includes('evidence-only analysis step')));
   console.log(JSON.stringify({passed:true,agent:agent.name,permission:'ask; Orvix readOnly handler always rejects',providerToolCount:captured[0].tools.length}));
  }finally{await api(`/session/${session.id}`,{method:'DELETE'});}
 });
})().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(()=>{runtime.shutdown();server.closeAllConnections();server.close();});
