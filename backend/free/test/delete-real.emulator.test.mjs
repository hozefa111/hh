import {test} from 'node:test';import A from 'node:assert/strict';import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';import {Firestore} from '../firestore.mjs';import R from '../../../functions/online/shared/engine.js';
const host=process.env.FIRESTORE_EMULATOR_HOST;
test('CF2 confirmed preview resumes against real Firestore versions and cascades exactly',{skip:!host,timeout:30000},async()=>{
 A.match(host,/^(127\.0\.0\.1|localhost):\d+$/);
 const built=await build({stdin:{contents:`import {KaliLiveRoom as Base} from './live-room.mjs';export default {fetch(){return new Response('fixture')}};export class KaliLiveRoom extends Base {constructor(ctx,env){super(ctx,env);this.identity.token=async()=>'owner';}}`,resolveDir:process.cwd(),sourcefile:'delete-real-fixture.mjs'},bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:workers']});
 const db=new Firestore('demo-three-patti',async()=>'owner',fetch,{origin:'http://'+host}),id='cf2_'+crypto.randomUUID().replaceAll('-',''),paths=new Set();
 const mf=new Miniflare(convertV4MiniflareOptions({name:'delete-real',modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-03-01',durableObjects:{KALI_LIVE_ROOMS:{className:'KaliLiveRoom',useSQLite:true}},bindings:{FIREBASE_PROJECT_ID:'demo-three-patti'},outboundService:async req=>{
  A.equal(new URL(req.url).hostname,'firestore.googleapis.com');const body=req.method==='GET'?undefined:await req.text();
  if(body){for(const w of JSON.parse(body).writes||[])if(w.update)paths.add(w.update.name.split('/documents/')[1]);}
  return fetch(req.url.replace('https://firestore.googleapis.com','http://'+host),{method:req.method,headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body});
 }}));
 try{
  const actor=(await mf.getDurableObjectNamespace('KALI_LIVE_ROOMS')).getByName(id);
  const api=async body=>{const response=await actor.fetch(new Request('https://actor/',{method:'POST',body:JSON.stringify({who:{uid:'owner',admin:true},body})}));const result=await response.json();A.equal(response.status,200,JSON.stringify(result));return result;};
  let room=R.create({id,code:'V2REALAA',uid:'owner',playerId:'p',name:'Owner',mode:6,sessionName:'Delete fixture'},Date.now());room=R.command(room,'owner',{type:'stop'},Date.now());room.completed=4;
  const session={source:'online',sessionName:room.sessionName,startTime:new Date(room.createdAt),endTime:new Date(room.endedAt),status:'stopped'};
  const writes=[db.set('sessions/'+id,session)];paths.add('sessions/'+id);
  for(let n=0;n<4;n++)for(const [path,data]of [['rounds/'+id+'_'+n,{sessionId:id,source:'online',timestamp:new Date(),scoreChanges:{p:155},hukumId:'p',hukumName:'Owner'}],['onlineRooms/'+id+'/hands/h'+n,{handNumber:n+1}]]){writes.push(db.set(path,data));paths.add(path);}
  await db.request(':commit','POST',{writes});await api({operation:'init',room,profiles:{},createFingerprint:'fixture'});
  const preview=await api({operation:'sessionHistory',action:'previewDelete',commandId:crypto.randomUUID()});A.equal(preview.roundCount,4);A.equal(preview.impacts[0].lifetimeChange,-620);
  const request={operation:'sessionHistory',action:'delete',previewToken:preview.previewToken,deleteRounds:true,commandId:crypto.randomUUID()};A.equal((await api(request)).pending,true);
  const until=Date.now()+15000;while((await api(request)).pending){A(Date.now()<until,'Cleanup did not finish');await new Promise(r=>setTimeout(r,100));}
  A.equal(await db.get('sessions/'+id),null);A(await db.get('onlineTombstones/'+id));A.equal((await db.get('sessionDeletions/'+id)).deletedRounds,4);
  A.equal((await db.scan('sessionDeletionArchives/'+id+'_'+(await db.get('sessionDeletions/'+id)).generation+'/rounds',null,100)).length,4);
  A.equal((await api(request)).pending,false);for(let n=0;n<4;n++)A.equal(await db.get('rounds/'+id+'_'+n),null);
 }finally{await mf.dispose();for(const path of paths)await db.request('/'+path,'DELETE');}
});
