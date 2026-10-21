import {DurableObject} from 'cloudflare:workers';
import {Firestore} from './firestore.mjs';
import {Identity} from './identity.mjs';
import {GameStore} from './store.mjs';
import serviceModule from '../../functions/online/service.js';
import R from '../../functions/online/shared/engine.js';
const origins=new Set(['https://hozefa111.github.io','https://patti-pro-a61d8.web.app','https://patti-pro-a61d8.firebaseapp.com','https://appassets.androidplatform.net']);
const random=n=>{const a=new Uint32Array(1),limit=Math.floor(0x100000000/n)*n;do{crypto.getRandomValues(a);}while(a[0]>=limit);return a[0]%n;};
const id=()=>crypto.randomUUID().replaceAll('-',''),code=()=>Array.from({length:8},()=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[random(32)]).join('');
export default {async fetch(request,env){
 const origin=request.headers.get('Origin'),headers={'Cache-Control':'no-store','Vary':'Origin'};
 if(origin&&!origins.has(origin))return Response.json({error:'Origin not allowed'},{status:403,headers});
 if(origin)Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS'});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(request.method!=='POST'||!['/kaliApi','/kaliConsumeExchange'].includes(new URL(request.url).pathname))return Response.json({error:'POST required'},{status:405,headers});
 if(Number(request.headers.get('Content-Length')||0)>16384)return new Response(null,{status:413,headers});
 const response=await env.KALI_COORDINATOR.getByName('prototype-v1').fetch(request);
 const output=new Response(response.body,response);for(const [k,v]of Object.entries(headers))output.headers.set(k,v);return output;
}};
export class KaliCoordinator extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.env=env;this.storage=ctx.storage;this.identity=new Identity(env);this.db=new Firestore(env.FIREBASE_PROJECT_ID,()=>this.identity.token());this.queue=Promise.resolve();
  this.store=new GameStore(this.db,(...args)=>this.track(...args),(id,active)=>this.trackDeletion(id,active));this.service=new serviceModule.GameService(this.store,{random,id,code});
  ctx.blockConcurrencyWhile(async()=>{
   const rooms=await this.storage.list({prefix:'room:'});
   for(const [key,r]of rooms)await this.storage.put(key,{id:r.id,recover:true});
   if(rooms.size||(await this.storage.list({prefix:'delete:'})).size)await this.storage.setAlarm(Date.now()+100);
  });
 }
 serial(fn){const result=this.queue.then(fn);this.queue=result.catch(()=>{});return result;}
 async track(roomId,room){
  const key='room:'+roomId,prior=await this.storage.get(key);
  if(room)for(const p of Object.values(room.members)){
   const was=prior?.members?.[p.uid];
   if(was&&was.status!=='Removed'&&p.status==='Removed'&&p.kind==='human'&&!p.reservation)await this.realtime('/onlineAcl/'+roomId+'/'+p.uid,'PUT',null);
  }
  if(room?.status==='stopped')await this.storage.delete(key);
  else if(room)await this.storage.put(key,room);
  else if(!await this.storage.get(key))await this.storage.put(key,{id:roomId,recover:true});
  await this.arm();
 }
 async trackDeletion(id,active){if(active){await this.storage.put('delete:'+id,{id});await this.cleanupAlarm(Date.now()+1000);}else await this.storage.delete('delete:'+id);}
 async arm(){
  const rooms=await this.storage.list({prefix:'room:'});let at=(await this.storage.list({prefix:'delete:'})).size?Date.now()+1000:Infinity;
  for(const r of rooms.values()){
   at=Math.min(at,Date.now()+(R.active(r)&&!r.paused?5000:30000));
   if(!r.paused&&R.active(r)&&r.hand.deadline!==null)at=Math.min(at,r.hand.deadline);
  }
  if(Number.isFinite(at)){const old=await this.storage.getAlarm();if(old===null||old>at)await this.storage.setAlarm(Math.max(Date.now()+100,at));}
 }
 async cleanupAlarm(at){const old=await this.storage.getAlarm();if(old===null||old>at)await this.storage.setAlarm(at);}
 async rate(key){const now=Date.now(),k='limit:'+key,old=await this.storage.get(k),same=old&&now-old.at<60000,count=same?old.count+1:1;if(count>90)throw Error('Too many requests; try again shortly');await this.storage.put(k,{at:same?old.at:now,count});await this.cleanupAlarm(now+60000);}
 async fetch(request){return this.serial(async()=>{
  try{
   const text=await request.text();if(text.length>16384)throw Error('Request too large');const body=JSON.parse(text);
   let result;
   if(new URL(request.url).pathname==='/kaliConsumeExchange'){
    if(typeof body.exchange!=='string'||!/^[a-f0-9]{64}$/.test(body.exchange))throw Error('Invalid exchange');
    const key='exchange:'+body.exchange,value=await this.storage.get(key);if(!value||value.expiresAt<Date.now())throw Error('Exchange expired');
    await this.storage.delete(key);result={token:await this.identity.customToken(value.uid)};
   }else{
    const token=/^Bearer (.+)$/.exec(request.headers.get('Authorization')||'');if(!token)throw Error('Sign in required');
    const who=await this.identity.verify(token[1]);await this.rate(who.uid);who.admin=who.admin||!!await this.db.get('admins/'+who.uid);
    if(body.operation==='create')result=await this.service.create(who,body);
    else if(body.operation==='sessionHistory')result=await this.service.history(who,body);
    else if(body.operation==='clock')result={serverNow:Date.now()};
    else if(body.operation==='presenceSync'){
     if(!/^[a-zA-Z0-9_-]{1,100}$/.test(body.roomId||''))throw Error('Invalid room');
     if(!await this.db.get('onlineRooms/'+body.roomId+'/members/'+who.uid))throw Error('Room admission required');
     const connections=await this.realtime('/onlinePresence/'+body.roomId+'/'+who.uid+'/connections');
     const connected=Object.keys(connections||{}).length>0;
     await this.service.presence(body.roomId,who.uid,connected);result={connected};
    }
    else if(body.operation==='presenceAccess'){
     if(!/^[a-zA-Z0-9_-]{1,100}$/.test(body.roomId||''))throw Error('Invalid room');
     if(!await this.db.get('onlineRooms/'+body.roomId+'/members/'+who.uid))throw Error('Room admission required');
     await this.realtime('/onlineAcl/'+body.roomId+'/'+who.uid,'PUT',true);await this.track(body.roomId);result={ok:true};
    }else if(body.operation==='register'){
     if(!who.admin)throw Error('Admin access required');const name=String(body.name||'').trim();if(!name||name.length>60)throw Error('Invalid name');const playerId=id();
     await this.db.request(':commit','POST',{writes:[this.db.set('players/'+playerId,{name,active:true,createdAt:new Date()},true)]});result={playerId};
    }else if(body.operation==='exchange'){
     const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);const exchange=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
     await this.storage.put('exchange:'+exchange,{uid:who.uid,expiresAt:Date.now()+30000});await this.cleanupAlarm(Date.now()+31000);result={exchange};
    }else result=await this.service.execute(who,body);
   }return Response.json({...result,serverNow:Date.now()});
  }catch(e){return Response.json({error:publicError(e)},{status:400});}
 });}
 async realtime(path,method='GET',value){
  const url=`https://${this.env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com${path}.json`,res=await fetch(url,{method,headers:{Authorization:'Bearer '+await this.identity.token(),'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(value)}),signal:AbortSignal.timeout(10000)});
  if(!res.ok)throw Error('Presence sync unavailable');return res.json();
 }
 async alarm(){return this.serial(async()=>{
  try{
   for(const {id}of(await this.storage.list({prefix:'delete:'})).values())await this.store.deletion.step(id);
   const rooms=await this.storage.list({prefix:'room:'});
   // One server read serves every tracked room. No private card state enters RTDB.
   const presence=rooms.size?await this.realtime('/onlinePresence'):null;
   for(const [key,cached]of rooms){
    let room=cached.recover?await this.db.get('onlineState/'+cached.id):cached;
    if(!room||room.status==='stopped'){await this.storage.delete(key);continue;}
    if(cached.recover)await this.storage.put(key,room);
    for(const p of Object.values(room.members))if(p.kind==='human'&&!p.reservation&&p.status!=='Removed'){
     const connected=Object.keys(presence?.[room.id]?.[p.uid]?.connections||{}).length>0;
     if(p.connected!==connected||connected&&p.status==='Disconnected')await this.service.presence(room.id,p.uid,connected);
     // Revoke access for former participants when room state changes, below.
    }
    room=await this.storage.get(key)||room;
    if(R.active(room)&&!room.paused&&room.hand.deadline!==null&&Date.now()>=room.hand.deadline)await this.service.due(room.id,room.hand.id,room.hand.turnGeneration);
   }
   // Bound ephemeral authentication/rate records; session/score history is never expired.
   for(const prefix of ['exchange:','limit:'])for(const [key,v]of await this.storage.list({prefix}))if((v.expiresAt||v.at+60000)<Date.now())await this.storage.delete(key);
  }catch(e){console.error('Kali alarm failed; retrying without inventing a move',e?.code||e?.name||'Error');await this.storage.setAlarm(Date.now()+5000);throw Error('Retry game alarm');}
  finally{await this.arm();}
 });}
}
function publicError(e){if(e?.status||e?.name==='JWTExpired'||e?.code?.startsWith('ERR_'))return 'Server connection or sign-in unavailable; reconnect and retry';return String(e?.message||'Action failed').slice(0,180);}
