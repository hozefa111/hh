import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPair,exportJWK,exportPKCS8,SignJWT} from 'jose';
import {Firestore} from '../firestore.mjs';
import R from '../../../functions/online/shared/engine.js';
import B from '../../../functions/online/shared/bot.js';
for(const mode of [4,6])test(mode+'-seat actual Worker enforces origins/auth, isolates rooms and completes a bot game through durable alarms', {skip:!process.env.KALI_WORKER_INTEGRATION,timeout:300000},async()=>{
 const emulator=process.env.FIRESTORE_EMULATOR_HOST;assert.match(emulator||'',/^(127\.0\.0\.1|localhost):\d+$/);
 const project='demo-three-patti',profile='worker_'+crypto.randomUUID().replaceAll('-',''),uid='uid_'+profile,created=new Set;
 const {publicKey,privateKey}=await generateKeyPair('RS256',{extractable:true}),jwk=await exportJWK(publicKey);Object.assign(jwk,{kid:'test-key',alg:'RS256',use:'sig'});
 const private_key=await exportPKCS8(privateKey),db=new Firestore(project,async()=>'owner',fetch,{origin:'http://'+emulator});
 await db.request(':commit','POST',{writes:[db.set('players/'+profile,{name:'Worker human test'},true)]});created.add('players/'+profile);await db.request(':commit','POST',{writes:[db.set('admins/'+uid,{admin:true},true)]});created.add('admins/'+uid);
 let roomId;const samples=[];
 let held=null;const wait=()=>{let release,entered;const promise=new Promise(r=>release=r),seen=new Promise(r=>entered=r);return {promise,release,entered,seen};};
 const presence={},globalPresenceReads=[];let adminReads=0,identityChecks=0,presenceFailures=0,disabled=false,revoked=false;const failedScans=[];
 const miniflare=new Miniflare(convertV4MiniflareOptions({name:'kali-test',modules:true,script:await readFile(new URL('../dist/worker.mjs',import.meta.url),'utf8'),compatibilityDate:'2026-03-01',
  durableObjects:{KALI_COORDINATOR:{className:'KaliCoordinator',useSQLite:true}},
  bindings:{FIREBASE_PROJECT_ID:project,FIREBASE_SERVICE_ACCOUNT:JSON.stringify({project_id:project,client_email:'test@demo-three-patti.iam.gserviceaccount.com',private_key})},
  outboundService:async request=>{
   const url=new URL(request.url),text=request.method==='GET'?undefined:await request.text();
   if(url.hostname==='firestore.googleapis.com'){
    if(held?.kind==='database'&&url.pathname.includes('/'+held.room+'/members/')){held.entered();await held.promise;}
    assert(url.pathname.includes('/projects/demo-three-patti/'));if(url.pathname.includes('/documents/admins/'))adminReads++;
    if(url.pathname.endsWith(':commit'))for(const w of JSON.parse(text).writes)if(w.update)created.add(w.update.name.split('/documents/')[1]);
    return fetch('http://'+emulator+url.pathname+url.search,{method:request.method,headers:{Authorization:'Bearer owner','Content-Type':'application/json'},...(text?{body:text}:{})});
   }
   if(url.hostname==='www.googleapis.com'&&url.pathname.includes('/jwk/'))return Response.json({keys:[jwk]},{headers:{'Cache-Control':'public, max-age=3600'}});
   if(url.hostname==='oauth2.googleapis.com')return Response.json({access_token:'test-only',expires_in:3600});
   if(url.hostname==='identitytoolkit.googleapis.com'){identityChecks++;const id=JSON.parse(text).localId[0];if(held?.kind==='auth'&&id==='slow_uid'){held.entered();await held.promise;}return Response.json({users:[{localId:id,disabled,validSince:revoked?String(Math.floor(Date.now()/1000)+60):'0'}]});}
   if(url.hostname===project+'-default-rtdb.firebaseio.com'){
    if(request.method==='PUT')return Response.json(true);
    if(/^\/onlinePresence\/[^/]+\.json$/.test(url.pathname)&&url.pathname.includes('/'+roomId+'.json')){globalPresenceReads.push(Date.now());if(presenceFailures>0){presenceFailures--;failedScans.push(Date.now());return Response.json({error:'Injected temporary presence outage'},{status:503});}}
    if(held?.kind==='presence'&&url.pathname.includes('/'+held.room+'/')){held.entered();await held.promise;}
    const whole=/^\/onlinePresence\/([^/]+)\.json$/.exec(url.pathname);if(whole)return Response.json(presence[whole[1]]||null);
    const match=/^\/onlinePresence\/([^/]+)\/([^/]+)\/connections\.json$/.exec(url.pathname);
    return Response.json(match?presence[match[1]]?.[match[2]]?.connections||null:presence);
   }
   throw Error('Unexpected network request in isolated runtime test');
  }
 }));
 try{
  const bad=await miniflare.dispatchFetch('http://worker/kaliApi',{method:'POST',headers:{Origin:'https://untrusted.example'},body:'{}'});assert.equal(bad.status,403);
  const missing=await miniflare.dispatchFetch('http://worker/kaliApi',{method:'POST',body:'{}'});assert.equal(missing.status,400);
  const token=await new SignJWT({user_id:uid,auth_time:Math.floor(Date.now()/1000)}).setProtectedHeader({alg:'RS256',kid:'test-key'}).setSubject(uid).setIssuer('https://securetoken.google.com/'+project).setAudience(project).setIssuedAt().setExpirationTime('1h').sign(privateKey);
  const api=async(body,endpoint='kaliApi')=>{
   const started=performance.now();const res=await miniflare.dispatchFetch('http://worker/'+endpoint,{method:'POST',headers:{Origin:'https://appassets.androidplatform.net',Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)}),value=await res.json();
   samples.push({operation:body.operation||body.action?.type||'exchange',requestMs:performance.now()-started,serverTiming:res.headers.get('Server-Timing'),heldDependency:held?.kind||null});
   assert.equal(res.headers.get('Access-Control-Allow-Origin'),'https://appassets.androidplatform.net');assert.equal(res.status,200,JSON.stringify(value));assert.match(res.headers.get('Server-Timing'),/auth;dur=/);assert.match(res.headers.get('X-Request-ID'),/^[a-f0-9-]{36}$/);assert.match(res.headers.get('Access-Control-Expose-Headers'),/Server-Timing/);return value;
  };
  for(const type of ['disabled','revoked']){
   if(type==='disabled')disabled=true;else revoked=true;
   const rejected=await miniflare.dispatchFetch('http://worker/kaliApi',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({operation:'clock'})});assert.equal(rejected.status,400,'Account changes apply without a cached-permission window');disabled=false;revoked=false;
  }
  const quotaToken=await new SignJWT({user_id:'quota_uid',auth_time:Math.floor(Date.now()/1000)}).setProtectedHeader({alg:'RS256',kid:'test-key'}).setSubject('quota_uid').setIssuer('https://securetoken.google.com/'+project).setAudience(project).setIssuedAt().setExpirationTime('1h').sign(privateKey);
  const quota=await Promise.all(Array.from({length:91},()=>miniflare.dispatchFetch('http://worker/kaliApi',{method:'POST',headers:{Authorization:'Bearer '+quotaToken},body:JSON.stringify({operation:'clock'})})));
  assert.equal(quota.filter(r=>r.status===200).length,90);assert.equal(quota.filter(r=>r.status===400).length,1,'Concurrent rate increments cannot be lost');
  const {exchange}=await api({operation:'exchange'});const consumeRequests=await Promise.all([1,2].map(()=>miniflare.dispatchFetch('http://worker/kaliConsumeExchange',{method:'POST',body:JSON.stringify({exchange})})));assert.deepEqual(consumeRequests.map(r=>r.status).sort(),[200,400]);
  const replay=await miniflare.dispatchFetch('http://worker/kaliConsumeExchange',{method:'POST',body:JSON.stringify({exchange})});assert.equal(replay.status,400);
  ({roomId}=await api({operation:'create',playerId:profile,mode}));presence[roomId]={[uid]:{connections:{test:true}}};
  await api({operation:'presenceAccess',roomId});
  assert.equal((await api({operation:'presenceSync',roomId})).connected,true);
  presence[roomId][uid].connections={};assert.equal((await api({operation:'presenceSync',roomId,connected:true})).connected,false);
  assert.equal((await db.get('onlineState/'+roomId)).members[uid].connected,false);
  presence[roomId][uid].connections={test:true};assert.equal((await api({operation:'presenceSync',roomId})).connected,true);
  assert.equal((await db.get('onlineState/'+roomId)).members[uid].connected,true);
  // Hold one dependency until an unrelated authenticated request has completed.
  // This deterministically fails with the previous single global queue.
  const second=(await api({operation:'create',playerId:profile,mode:4})).roomId;presence[second]={[uid]:{connections:{test:true}}};
  for(const kind of ['auth','database','presence']){
   held={kind,room:roomId,...wait()};const release=held.release;
   const slowToken=kind==='auth'?await new SignJWT({user_id:'slow_uid',auth_time:Math.floor(Date.now()/1000)}).setProtectedHeader({alg:'RS256',kid:'test-key'}).setSubject('slow_uid').setIssuer('https://securetoken.google.com/'+project).setAudience(project).setIssuedAt().setExpirationTime('1h').sign(privateKey):token;
   const slowBody=kind==='auth'?{operation:'clock'}:{operation:kind==='database'?'presenceAccess':'presenceSync',roomId};
   const slow=miniflare.dispatchFetch('http://worker/kaliApi',{method:'POST',headers:{Authorization:'Bearer '+slowToken,'Content-Type':'application/json'},body:JSON.stringify(slowBody)});
   try{await Promise.race([held.seen,new Promise((_,reject)=>setTimeout(()=>reject(Error('Slow dependency not reached')),3000))]);
    const fast=await Promise.race([api(kind==='auth'?{operation:'clock',roomId}:kind==='database'?{operation:'sessionHistory',sessionId:second,roomId,action:'rename',name:'Other isolated room',commandId:crypto.randomUUID()}:{operation:'presenceSync',roomId:second}),new Promise((_,reject)=>setTimeout(()=>reject(Error('Unrelated room blocked by '+kind)),3000))]);assert(fast);
   }finally{held=null;release();await slow;}
  }
  const other=await db.get('onlineState/'+second);await api({roomId:second,commandId:crypto.randomUUID(),revision:other.revision,action:{type:'stop'}});
  const send=async action=>{const r=await db.get('onlineState/'+roomId);return api({roomId,commandId:crypto.randomUUID(),revision:r.revision,handId:r.hand?.id,turnGeneration:r.hand?.turnGeneration,action});};
  for(let seat=2;seat<=mode;seat++)await send({type:'bot',seat});await send({type:'ready'});
  assert(adminReads>=1);const gameAdminReads=adminReads;
  // Disconnect scanning remains authoritative while bot alarms reuse its cadence.
  presenceFailures=1;presence[roomId][uid].connections={};const pauseBy=Date.now()+15000;let paused;while(Date.now()<pauseBy){paused=await db.get('onlineState/'+roomId);if(paused.paused)break;await new Promise(r=>setTimeout(r,150));}assert(paused.paused,'A real disconnect pauses after a transient presence failure recovers');assert.equal(failedScans.length,1);const afterFailure=globalPresenceReads.find(t=>t>failedScans[0]+100);assert(afterFailure-failedScans[0]>=4500,'An overdue turn cannot override server retry backoff');const pausedCards=JSON.stringify(paused.hand.hands);presence[roomId][uid].connections={test:true};await api({operation:'presenceSync',roomId});await send({type:'resume'});assert.equal(JSON.stringify((await db.get('onlineState/'+roomId)).hand.hands),pausedCards);
  let steps=0,sawBot=false,timeoutTurn=null,sawTimeout=false;
  while(true){
   assert(++steps<1000);const r=await db.get('onlineState/'+roomId);if(!R.active(r))break;
   if(process.env.KALI_REST_TRACE&&steps%20===0)console.log('Runtime progress',r.hand.phase,r.hand.tricks.length,r.members[r.hand.turn].kind,Math.ceil((r.hand.deadline-Date.now())/1000),sawTimeout);
   assert(!r.paused,'No false disconnect while live presence is connected');
   if(r.hand.auction.some(a=>a.reason==='bot'))sawBot=true;
   if(!sawTimeout&&r.hand.phase==='playing'&&r.hand.turn===uid){
    timeoutTurn??={id:r.hand.id,generation:r.hand.turnGeneration,card:R.legal(r.hand.hands[uid],r.hand.trick)[0]};
    await new Promise(resolve=>setTimeout(resolve,250));
   }
   else if(r.hand.turn===uid){await send(B.decide(R.publicState(r),uid,R.privateState(r,uid).cards));}
   else await new Promise(resolve=>setTimeout(resolve,250));
   if(timeoutTurn&&!sawTimeout&&r.events.some(e=>e.uid===uid&&e.type==='card'&&e.reason==='timeout')){
    sawTimeout=true;
    const late=await miniflare.dispatchFetch('http://worker/kaliApi',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({roomId,revision:0,handId:timeoutTurn.id,turnGeneration:timeoutTurn.generation,commandId:crypto.randomUUID(),action:{type:'play',card:timeoutTurn.card}})});
    assert.equal(late.status,400,'Late manual action cannot replay a timed-out turn');
   }
  }
  assert(sawBot);assert(sawTimeout,'Real 30-second alarm played a legal card automatically');const room=await db.get('onlineState/'+roomId);assert.equal(room.completed,1);assert.equal(Object.values(room.hand.captured).reduce((a,b)=>a+b),250);
  assert((await db.get('rounds/online_'+room.hand.id)).timestamp instanceof Date);
  assert.equal(adminReads,gameAdminReads,'Ordinary room actions do not fetch the tracker administrator document');assert(identityChecks>10,'Account revocation checks remain on authenticated commands');for(let i=1;i<globalPresenceReads.length;i++)assert(globalPresenceReads[i]-globalPresenceReads[i-1]>=4500,'Bot alarms do not repeat per-room presence scans inside five seconds');
  await send({type:'stop'});assert.equal((await db.get('sessions/'+roomId)).status,'stopped');
  const preview=await api({operation:'sessionHistory',sessionId:roomId,action:'previewDelete',commandId:crypto.randomUUID()});assert.equal(preview.roundCount,1);
  await api({operation:'sessionHistory',sessionId:roomId,action:'delete',deleteRounds:true,previewToken:preview.previewToken,commandId:crypto.randomUUID()});
  // The client stops here: Durable Object alarms must finish the destructive job.
  const until=Date.now()+20000;while(await db.get('sessions/'+roomId)&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,300));
  assert.equal(await db.get('sessions/'+roomId),null);assert.equal(await db.get('rounds/online_'+room.hand.id),null);assert.equal(await db.get('meta/sessionDeletionLock'),null);

  await mkdir('../../test-results/kali',{recursive:true});await writeFile('../../test-results/kali/backend-performance-'+mode+'-report.json',JSON.stringify({scope:'Actual Miniflare Worker and local Firestore emulator; external identity/presence endpoints are isolated mocks, not physical-phone or production WAN timings',checks:['Room B completes while room A authentication is held','Room B completes while room A database is held','Room B completes while room A presence is held','Concurrent one-use exchange admits exactly one consumer','Real bot alarms, disconnect/reconnect and human timeout finish a 250-point hand'],samples},null,2));
 }finally{await miniflare.dispose();for(const path of created)await db.request('/'+path,'DELETE');}
});
