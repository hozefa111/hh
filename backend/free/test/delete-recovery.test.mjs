import {test} from 'node:test';
import A from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {RestMemory} from './helpers/rest-memory.mjs';
import R from '../../../functions/online/shared/engine.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const baseline=process.env.DELETE_RECOVERY_BASELINE==='true';
// Test-only inspection is not included in the deployed worker.
const built=await build({stdin:{contents:`import {KaliLiveRoom as Base} from './live-room.mjs';export default {fetch(){return new Response('fixture')}};export class KaliLiveRoom extends Base {constructor(ctx,env){super(ctx,env);this.identity.token=async()=>'fixture';}async fetch(req){if(req.headers.get('X-Fixture-Inspect'))return Response.json({retry:this.store.read('deleteRetry'),attempts:this.store.read('deleteAttempts'),deleted:this.store.read('deleted')});return super.fetch(req);}}`,resolveDir:process.cwd(),sourcefile:'delete-recovery-fixture.mjs'},bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:workers']});
for(const code of ['UNAVAILABLE','RESOURCE_EXHAUSTED'])test('durable deletion retry after '+code,{timeout:20000},async()=>{
 const memory=new RestMemory(),id='cf2_'+'3'.repeat(32);let fail=false,failures=0;
 const mf=new Miniflare(convertV4MiniflareOptions({name:'delete-recovery',modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-03-01',durableObjects:{KALI_LIVE_ROOMS:{className:'KaliLiveRoom',useSQLite:true}},bindings:{FIREBASE_PROJECT_ID:'demo-three-patti'},outboundService:async req=>{
  const u=new URL(req.url),body=req.method==='GET'?undefined:await req.text();
  if(u.hostname==='oauth2.googleapis.com')throw Error('Fixture must not need real credentials');
  if(u.hostname==='firestore.googleapis.com'){
   if(fail&&u.pathname.endsWith(':beginTransaction')){fail=false;failures++;return Response.json({error:{status:code}},{status:code==='UNAVAILABLE'?503:429});}
   return memory.fetch(req.url,{method:req.method,body});
  }throw Error('Unexpected fixture transport');
 }}));
 // Inject a cached service token only in the test subclass; production still authenticates normally.
 try{
  const actor=(await mf.getDurableObjectNamespace('KALI_LIVE_ROOMS')).getByName(id);
  const call=async b=>{const res=await actor.fetch(new Request('https://actor/',{method:'POST',body:JSON.stringify({who:{uid:'owner',admin:true},body:b})}));const data=await res.json();A.equal(res.status,200,JSON.stringify(data));return data;};
  const inspect=async()=> (await actor.fetch(new Request('https://actor/',{headers:{'X-Fixture-Inspect':'yes'}}))).json();
  const wait=async fn=>{const until=Date.now()+8000;for(;;){const v=await fn();if(v)return v;A(Date.now()<until,'Fixture timed out');await sleep(20);}};
  let room=R.create({id,code:'V2DELAYA',uid:'owner',playerId:'p',name:'Owner',mode:4,sessionName:'Fixture'},Date.now());
  room=R.command(room,'owner',{type:'stop'},Date.now());
  memory.put('sessions/'+id,{source:'online',sessionName:room.sessionName,startTime:new Date(room.createdAt),endTime:new Date(room.endedAt),status:'stopped'});
  memory.put('rounds/fixture',{sessionId:id,scoreChanges:{p:310},hukumId:'p',hukumName:'Owner'});
  memory.put('rounds/unrelated',{sessionId:'other',scoreChanges:{p:100}});
  await call({operation:'init',room,profiles:{},createFingerprint:'fixture'});
  const preview=await call({operation:'sessionHistory',action:'previewDelete',commandId:crypto.randomUUID()});
  // Preview has settled; fail only the following asynchronous cleanup transaction.
  const request={operation:'sessionHistory',action:'delete',deleteRounds:true,previewToken:preview.previewToken,commandId:crypto.randomUUID()};
  // Arm the fault at the tombstone commit boundary, after acceptance validation.
  const oldFetch=memory.fetch.bind(memory);memory.fetch=async(url,init)=>{const body=init.body?JSON.parse(init.body):{};const result=await oldFetch(url,init);if(body.writes?.some(w=>w.update?.name.endsWith('/onlineTombstones/'+id)))fail=true;return result;};
  A.equal((await call(request)).pending,true);
  const stalled=await wait(async()=>{const s=await inspect();return failures&&s.retry>Date.now()?s:null;});
  const delay=stalled.retry-Date.now();A.equal((await call(request)).pending,true);A(memory.get('rounds/fixture'),'Failure must not falsely remove points');
  console.log('DELETE_RETRY',JSON.stringify({baseline,code,delayMs:delay}));
  if(baseline||code==='RESOURCE_EXHAUSTED'){A(delay>290000);return;}
  A(delay<=1000&&delay>0,'A transient failure should not incur the quota cooldown');
  await wait(async()=> (await inspect()).deleted?.complete);
  A.equal(memory.get('rounds/fixture'),null);A.equal(memory.get('rounds/unrelated').scoreChanges.p,100);A(memory.get('onlineTombstones/'+id));
  A.equal(memory.get('sessionDeletions/'+id).status,'complete');A.equal((await call(request)).pending,false);A.equal((await call(request)).pending,false);
 }finally{await mf.dispose();}
});
