import {test} from 'node:test';
import A from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPair,exportJWK,exportPKCS8,SignJWT} from 'jose';
import {RestMemory} from './helpers/rest-memory.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn,ms=10000){const end=Date.now()+ms;while(!fn()){A(Date.now()<end,'Timed out in isolated progress fixture');await sleep(10);}}
for(const mode of [4,6])test(mode+' seats: a slow history export must not hold the next bot turn',{timeout:30000},async()=>{
 const memory=new RestMemory();memory.put('players/admin',{name:'Fixture admin'});const keys=await generateKeyPair('RS256',{extractable:true}),jwk=await exportJWK(keys.publicKey);Object.assign(jwk,{kid:'progress',alg:'RS256',use:'sig'});
 const token=await new SignJWT({user_id:'admin',admin:true,auth_time:Math.floor(Date.now()/1000)}).setProtectedHeader({alg:'RS256',kid:'progress'}).setSubject('admin').setIssuer('https://securetoken.google.com/demo-three-patti').setAudience('demo-three-patti').setIssuedAt().setExpirationTime('1h').sign(keys.privateKey);
 let failed=0,held=false,release,opened=false,state;const gate=new Promise(r=>release=r);const frames=[];
 const mf=new Miniflare(convertV4MiniflareOptions({name:'progress-test',modules:true,script:await readFile(new URL('../dist/worker.mjs',import.meta.url),'utf8'),compatibilityDate:'2026-03-01',durableObjects:{KALI_COORDINATOR:{className:'KaliCoordinator',useSQLite:true},KALI_LIVE_ROOMS:{className:'KaliLiveRoom',useSQLite:true},KALI_LIVE_DIRECTORY:{className:'KaliLiveDirectory',useSQLite:true}},bindings:{ENABLE_CLOUDFLARE_V2:'true',FIREBASE_PROJECT_ID:'demo-three-patti',FIREBASE_SERVICE_ACCOUNT:JSON.stringify({project_id:'demo-three-patti',client_email:'progress@test.iam.gserviceaccount.com',private_key:await exportPKCS8(keys.privateKey)})},outboundService:async req=>{
  const u=new URL(req.url),body=req.method==='GET'?undefined:await req.text();if(u.hostname==='www.googleapis.com')return Response.json({keys:[jwk]});if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'fixture',expires_in:3600});if(u.hostname==='identitytoolkit.googleapis.com')return Response.json({users:[{localId:'admin',validSince:'0'}]});
  if(u.hostname==='firestore.googleapis.com'){
   if(u.pathname.endsWith(':beginTransaction')){if(!failed++){return Response.json({error:{status:'UNAVAILABLE'}},{status:503});}if(!opened){held=true;await gate;}}
   return memory.fetch(req.url,{method:req.method,body});
  }throw Error('Unexpected fixture transport');
 }}));let ws;
 const api=async body=>{const r=await mf.dispatchFetch('https://game/kaliApi',{method:'POST',headers:{Origin:'https://hozefa111.github.io',Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({clientProtocol:2,...body})});const v=await r.json();A.equal(r.status,200,JSON.stringify(v));return v;};
 let roomId;const send=async action=>{const out=await api({roomId,revision:state.room.revision,handId:state.room.hand?.id,turnGeneration:state.room.hand?.turnGeneration,commandId:crypto.randomUUID(),action});await wait(()=>state.room.revision>=out.revision);};
 try{
  ({roomId}=await api({operation:'create',mode,playerId:'admin',commandId:crypto.randomUUID()}));const ticket=await api({operation:'socketTicket',roomId}),res=await mf.dispatchFetch('https://game/kaliSocket?roomId='+roomId,{headers:{Upgrade:'websocket',Origin:'https://hozefa111.github.io','Sec-WebSocket-Protocol':'kali.v2, ticket.'+ticket.ticket}});A.equal(res.status,101);ws=res.webSocket;ws.accept();ws.addEventListener('message',e=>{if(e.data==='pong')return;state=JSON.parse(e.data);frames.push({at:Date.now(),generation:state.room.hand?.turnGeneration});});await wait(()=>state);
  for(let seat=2;seat<=mode;seat++)await send({type:'bot',seat});await send({type:'ready'});await send({type:'void'});await wait(()=>failed>0);await sleep(100);await send({type:'ready'});await wait(()=>held);
  const start=Date.now(),generation=state.room.hand.turnGeneration,deadline=state.room.hand.deadline;A.equal(state.room.members[state.room.hand.turn].kind,'bot');await sleep(2200);
  const progressed=state.room.hand.turnGeneration>generation,observedWaitMs=Date.now()-start;console.log('BOT_EXPORT_PROGRESS',JSON.stringify({mode,baseline:process.env.PROGRESS_BASELINE==='true',exportStillHeld:!opened,generationBefore:generation,generationAfter:state.room.hand.turnGeneration,deadlineWasMs:deadline-start,observedWaitMs,progressed}));
  if(process.env.PROGRESS_BASELINE==='true')A.equal(progressed,false,'The unpatched actor must reproduce the held bot turn');else A.equal(progressed,true,'A held Firestore request must not hold a due bot action');
  if(process.env.PROGRESS_BASELINE!=='true'){
   await wait(()=>state.room.hand.turn==='admin');const before=(await api({operation:'liveStats',roomId})).alarmApi.reads;await sleep(2200);const after=(await api({operation:'liveStats',roomId})).alarmApi.reads;A(after-before<=2,'An in-flight export must not spin alarms each second during a human turn');console.log('HELD_EXPORT_IDLE_ALARMS',JSON.stringify({mode,alarmReads:after-before,observedMs:2200}));
  }
  opened=true;release();await wait(()=>state.room.hand.turnGeneration>generation);await send({type:'stop',void:true});A.equal(state.room.completed,0,'Voided fixtures must not fabricate scores');await wait(()=>memory.get('sessions/'+roomId)?.status==='stopped');A.equal([...memory.docs.keys()].filter(p=>p.startsWith('rounds/')).length,0,'Voided history must not produce lifetime points');
 }finally{opened=true;release();try{ws?.close();}catch{}await mf.dispose();}
});
