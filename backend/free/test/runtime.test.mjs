import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPair,exportJWK,exportPKCS8,SignJWT} from 'jose';
import {Firestore} from '../firestore.mjs';
import R from '../../../functions/online/shared/engine.js';
import B from '../../../functions/online/shared/bot.js';
test('actual Worker runtime enforces origins/auth and completes a bot game through durable alarms', {skip:!process.env.KALI_WORKER_INTEGRATION,timeout:300000},async()=>{
 const emulator=process.env.FIRESTORE_EMULATOR_HOST;assert.match(emulator||'',/^(127\.0\.0\.1|localhost):\d+$/);
 const project='demo-three-patti',profile='worker_'+crypto.randomUUID().replaceAll('-',''),uid='uid_'+profile,created=new Set;
 const {publicKey,privateKey}=await generateKeyPair('RS256',{extractable:true}),jwk=await exportJWK(publicKey);Object.assign(jwk,{kid:'test-key',alg:'RS256',use:'sig'});
 const private_key=await exportPKCS8(privateKey),db=new Firestore(project,async()=>'owner',fetch,{origin:'http://'+emulator});
 await db.request(':commit','POST',{writes:[db.set('players/'+profile,{name:'Worker human test'},true)]});created.add('players/'+profile);
 let roomId;
 const presence={};
 const miniflare=new Miniflare(convertV4MiniflareOptions({name:'kali-test',modules:true,script:await readFile(new URL('../dist/worker.mjs',import.meta.url),'utf8'),compatibilityDate:'2026-03-01',
  durableObjects:{KALI_COORDINATOR:{className:'KaliCoordinator',useSQLite:true}},
  bindings:{FIREBASE_PROJECT_ID:project,FIREBASE_SERVICE_ACCOUNT:JSON.stringify({project_id:project,client_email:'test@demo-three-patti.iam.gserviceaccount.com',private_key})},
  outboundService:async request=>{
   const url=new URL(request.url),text=request.method==='GET'?undefined:await request.text();
   if(url.hostname==='firestore.googleapis.com'){
    assert(url.pathname.includes('/projects/demo-three-patti/'));
    if(url.pathname.endsWith(':commit'))for(const w of JSON.parse(text).writes)if(w.update)created.add(w.update.name.split('/documents/')[1]);
    return fetch('http://'+emulator+url.pathname+url.search,{method:request.method,headers:{Authorization:'Bearer owner','Content-Type':'application/json'},...(text?{body:text}:{})});
   }
   if(url.hostname==='www.googleapis.com'&&url.pathname.includes('/jwk/'))return Response.json({keys:[jwk]},{headers:{'Cache-Control':'public, max-age=3600'}});
   if(url.hostname==='oauth2.googleapis.com')return Response.json({access_token:'test-only',expires_in:3600});
   if(url.hostname==='identitytoolkit.googleapis.com')return Response.json({users:[{localId:uid,validSince:'0'}]});
   if(url.hostname===project+'-default-rtdb.firebaseio.com'){
    if(request.method==='PUT')return Response.json(true);
    return Response.json(presence);
   }
   throw Error('Unexpected network request in isolated runtime test');
  }
 }));
 try{
  const bad=await miniflare.dispatchFetch('http://worker/kaliApi',{method:'POST',headers:{Origin:'https://untrusted.example'},body:'{}'});assert.equal(bad.status,403);
  const missing=await miniflare.dispatchFetch('http://worker/kaliApi',{method:'POST',body:'{}'});assert.equal(missing.status,400);
  const token=await new SignJWT({user_id:uid,auth_time:Math.floor(Date.now()/1000),admin:true}).setProtectedHeader({alg:'RS256',kid:'test-key'}).setSubject(uid).setIssuer('https://securetoken.google.com/'+project).setAudience(project).setIssuedAt().setExpirationTime('1h').sign(privateKey);
  const api=async(body,endpoint='kaliApi')=>{
   const res=await miniflare.dispatchFetch('http://worker/'+endpoint,{method:'POST',headers:{Origin:'https://appassets.androidplatform.net',Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)}),value=await res.json();
   assert.equal(res.headers.get('Access-Control-Allow-Origin'),'https://appassets.androidplatform.net');assert.equal(res.status,200,JSON.stringify(value));return value;
  };
  const {exchange}=await api({operation:'exchange'});const consume=await api({exchange},'kaliConsumeExchange');assert(consume.token);
  const replay=await miniflare.dispatchFetch('http://worker/kaliConsumeExchange',{method:'POST',body:JSON.stringify({exchange})});assert.equal(replay.status,400);
  ({roomId}=await api({operation:'create',playerId:profile,mode:6}));presence[roomId]={[uid]:{connections:{test:true}}};
  await api({operation:'presenceAccess',roomId});
  const send=async action=>{const r=await db.get('onlineState/'+roomId);return api({roomId,commandId:crypto.randomUUID(),revision:r.revision,handId:r.hand?.id,turnGeneration:r.hand?.turnGeneration,action});};
  for(let seat=2;seat<=6;seat++)await send({type:'bot',seat});await send({type:'ready'});
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
  await send({type:'stop'});assert.equal((await db.get('sessions/'+roomId)).status,'stopped');
 }finally{await miniflare.dispose();for(const path of created)await db.request('/'+path,'DELETE');}
});
