import {test} from 'node:test';import A from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {probeAllowed,readHealthProbe} from '../progress.mjs';
import R from '../../../functions/online/shared/engine.js';
const token='a'.repeat(64),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),n=>n.toString(16).padStart(2,'0')).join('');
test('operator health requires an expiring single-room secret and rejects before lookup',async()=>{
 const now=Date.now(),setting='V2TESTAA@'+(now+60000)+'@'+hash;
 const req=new Request('https://game/kaliRoomHealth?code=V2TESTAA',{headers:{Authorization:'Bearer '+token}});
 A(await probeAllowed(req,setting,'V2TESTAA',now));A(!await probeAllowed(req,setting,'V2OTHERX',now));A(!await probeAllowed(req,setting,'V2TESTAA',now+60001));A(!await probeAllowed(req,'V2TESTAA@'+(now+7200000)+'@'+hash,'V2TESTAA',now));A(!await probeAllowed(new Request(req.url),setting,'V2TESTAA',now));
 let calls=0;const env={ROOM_HEALTH_PROBE:setting,KALI_LIVE_DIRECTORY:{getByName(){calls++;throw Error('Must not query');}}};
 A.equal((await readHealthProbe(new Request(req.url),env)).status,404);A.equal(calls,0);
});
for(const mode of [4,6])test(mode+'-seat SQLite operator observation preserves state/cards and exposes only safe fields',{timeout:20000},async()=>{
 const id='cf2_'+'1'.repeat(32),code='V2TESTAA',setting=code+'@'+(Date.now()+60000)+'@'+hash;
 const mf=new Miniflare(convertV4MiniflareOptions({name:'health-probe',modules:true,script:await readFile(new URL('../dist/worker.mjs',import.meta.url),'utf8'),compatibilityDate:'2026-03-01',durableObjects:{KALI_COORDINATOR:{className:'KaliCoordinator',useSQLite:true},KALI_LIVE_ROOMS:{className:'KaliLiveRoom',useSQLite:true},KALI_LIVE_DIRECTORY:{className:'KaliLiveDirectory',useSQLite:true}},bindings:{ROOM_HEALTH_PROBE:setting,FIREBASE_PROJECT_ID:'demo-three-patti',FIREBASE_SERVICE_ACCOUNT:JSON.stringify({project_id:'demo-three-patti',client_email:'unused@test',private_key:'unused'})},outboundService:()=>{throw Error('Health must not contact Firebase');}}));
 try{
  const dir=(await mf.getDurableObjectNamespace('KALI_LIVE_DIRECTORY')).getByName('directory-v2'),actor=(await mf.getDurableObjectNamespace('KALI_LIVE_ROOMS')).getByName(id);
  await dir.fetch(new Request('https://directory/',{method:'POST',body:JSON.stringify({op:'reserve',id,code,uid:'PRIVATE_UID'})}));
  let r=R.create({id,code,uid:'PRIVATE_UID',playerId:'PRIVATE_PROFILE',name:'PRIVATE_NAME',mode},Date.now()),n=0;
  const send=(uid,action)=>r=R.command(r,uid,action,Date.now(),max=>n++%max);
  for(let seat=2;seat<=mode;seat++)send('PRIVATE_UID',{type:'bot',seat,botId:'bot_'+seat});send('PRIVATE_UID',{type:'ready'});
  while(r.hand.phase==='auction')send(r.hand.turn,{type:'bid',...(r.hand.finalBid?{keep:true}:{pass:true})});send(r.hand.turn,{type:'trump',suit:'H'});send(r.hand.turn,{type:'partners',called:R.deck(mode,r.config).find(c=>!r.hand.hands[r.hand.turn].includes(c)),...(mode===6?{direct:'bot_2'}:{})});send('PRIVATE_UID',{type:'pause'});
  const call=async body=>(await actor.fetch(new Request('https://actor/',{method:'POST',body:JSON.stringify({who:{uid:'PRIVATE_UID',admin:true},body})}))).json();
  await call({operation:'init',room:r,profiles:{},createFingerprint:'fixture'});const before=await call({operation:'snapshot'});
  for(let i=0;i<3;i++){
   const result=await mf.dispatchFetch('https://game/kaliRoomHealth?code='+code,{headers:{Authorization:'Bearer '+token}});A.equal(result.status,200);const safe=await result.json();A.equal(safe.paused,true);A.equal(safe.mode,mode);A.equal(safe.handNumber,1);A.equal(safe.revision,before.room.revision);A(!/PRIVATE|hands|secret|partners|cards|uid|Bearer/.test(JSON.stringify(safe)));
  }
  const after=await call({operation:'snapshot'});A.deepEqual(after.room,before.room);A.deepEqual(after.own,before.own);
  A.equal((await mf.dispatchFetch('https://game/kaliRoomHealth?code='+code)).status,404);
  const denied=await actor.fetch(new Request('https://actor/',{method:'POST',body:JSON.stringify({body:{operation:'operatorHealth',code}})}));A.equal(denied.status,404);
 }finally{await mf.dispose();}
});
