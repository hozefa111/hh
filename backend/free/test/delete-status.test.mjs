import {test} from 'node:test';
import A from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPair,exportJWK,exportPKCS8,SignJWT} from 'jose';
import {RestMemory} from './helpers/rest-memory.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('accepted deletion status does not wait behind slow Firestore cleanup',{timeout:30000},async()=>{
 const memory=new RestMemory();memory.put('players/p',{name:'Fixture admin'});memory.put('rounds/unrelated',{sessionId:'other',scoreChanges:{p:100}});
 const keys=await generateKeyPair('RS256',{extractable:true}),jwk=await exportJWK(keys.publicKey);Object.assign(jwk,{kid:'delete-status',alg:'RS256',use:'sig'});
 let hold=false,held=false,release;const gate=new Promise(r=>release=r);
 const mf=new Miniflare(convertV4MiniflareOptions({name:'delete-status',modules:true,script:await readFile(process.env.DELETE_STATUS_WORKER||new URL('../dist/worker.mjs',import.meta.url),'utf8'),compatibilityDate:'2026-03-01',durableObjects:{KALI_COORDINATOR:{className:'KaliCoordinator',useSQLite:true},KALI_LIVE_ROOMS:{className:'KaliLiveRoom',useSQLite:true},KALI_LIVE_DIRECTORY:{className:'KaliLiveDirectory',useSQLite:true}},bindings:{ENABLE_CLOUDFLARE_V2:'true',FIREBASE_PROJECT_ID:'demo-three-patti',FIREBASE_SERVICE_ACCOUNT:JSON.stringify({project_id:'demo-three-patti',client_email:'delete@test.iam.gserviceaccount.com',private_key:await exportPKCS8(keys.privateKey)})},outboundService:async req=>{
  const u=new URL(req.url),body=req.method==='GET'?undefined:await req.text();if(u.hostname==='www.googleapis.com')return Response.json({keys:[jwk]});if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'fixture',expires_in:3600});if(u.hostname==='identitytoolkit.googleapis.com')return Response.json({users:[{localId:JSON.parse(body).localId[0],validSince:'0'}]});
  if(u.hostname==='firestore.googleapis.com'){if(hold&&u.pathname.endsWith(':beginTransaction')){held=true;await gate;}return memory.fetch(req.url,{method:req.method,body});}throw Error('Unexpected fixture transport');
 }}));
 const token=await new SignJWT({user_id:'u',admin:true,auth_time:Math.floor(Date.now()/1000)}).setProtectedHeader({alg:'RS256',kid:'delete-status'}).setSubject('u').setIssuer('https://securetoken.google.com/demo-three-patti').setAudience('demo-three-patti').setIssuedAt().setExpirationTime('1h').sign(keys.privateKey);
 const api=async(body,uid='u')=>{const r=await mf.dispatchFetch('https://game/kaliApi',{method:'POST',headers:{Origin:'https://hozefa111.github.io',Authorization:'Bearer '+(uid==='u'?token:await new SignJWT({user_id:uid,auth_time:Math.floor(Date.now()/1000)}).setProtectedHeader({alg:'RS256',kid:'delete-status'}).setSubject(uid).setIssuer('https://securetoken.google.com/demo-three-patti').setAudience('demo-three-patti').setIssuedAt().setExpirationTime('1h').sign(keys.privateKey)),'Content-Type':'application/json'},body:JSON.stringify({clientProtocol:2,...body})});return {status:r.status,...await r.json()};};
 const wait=async fn=>{for(let n=0;n<600&&!fn();n++)await sleep(10);A(fn(),'Fixture timed out');};
 try{
  const {roomId}=await api({operation:'create',playerId:'p',mode:6,sessionName:'Delete fixture',commandId:crypto.randomUUID()}),snapshot=await api({operation:'snapshot',roomId});await api({roomId,revision:snapshot.room.revision,commandId:crypto.randomUUID(),action:{type:'stop'}});await wait(()=>memory.get('sessions/'+roomId)?.status==='stopped');
  const preview=await api({operation:'sessionHistory',sessionId:roomId,action:'previewDelete',expectedName:'Delete fixture',commandId:crypto.randomUUID()});
  const request={operation:'sessionHistory',sessionId:roomId,action:'delete',deleteRounds:true,previewToken:preview.previewToken,expectedName:'Delete fixture',commandId:crypto.randomUUID()};
  A.equal((await api(request)).pending,true);hold=true;await wait(()=>held);
  const start=Date.now();let resolved=false,resolvedAt;const poll=api(request).then(result=>{resolved=true;resolvedAt=Date.now();return result;});await sleep(350);
  const prompt=resolved;hold=false;release();const result=await poll;
  console.log('DELETE_STATUS_WAIT',JSON.stringify({baseline:process.env.DELETE_STATUS_BASELINE==='true',prompt,waitMs:resolvedAt-start}));
  A.equal(result.status,200);
  if(process.env.DELETE_STATUS_BASELINE==='true')A.equal(prompt,false);else{A.equal(prompt,true,'Status poll must not wait for a slow cleanup transaction');A.equal(result.pending,true);}
  await wait(()=>memory.get('sessionDeletions/'+roomId)?.status==='complete');
  const done=await api(request);A.equal(done.pending,false);A.equal(memory.get('sessions/'+roomId),null);A.equal(memory.get('rounds/unrelated').scoreChanges.p,100);A(memory.get('onlineTombstones/'+roomId));
  const repeated=await api(request);A.equal(repeated.pending,false);A.equal(memory.get('rounds/unrelated').scoreChanges.p,100);
  const denied=await api(request,'stranger');A.notEqual(denied.status,200);A.match(denied.error,/Admin access/);
 }finally{hold=false;release();await mf.dispose();}
});
