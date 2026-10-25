export {KaliLiveRoom} from './live-room.mjs';
export {KaliLiveDirectory} from './live-router.mjs';
import {liveRoute} from './live-router.mjs';
import {DurableObject} from 'cloudflare:workers';
import {failure} from './errors.mjs';
import {Firestore,quotaError} from './firestore.mjs';
import {Identity} from './identity.mjs';
import {Timings,KeyedQueue,Slots} from './coordination.mjs';
import {GameStore} from './store.mjs';
import serviceModule from '../../functions/online/service.js';
import R from '../../functions/online/shared/engine.js';
const origins=new Set(['https://hozefa111.github.io','https://patti-pro-a61d8.web.app','https://patti-pro-a61d8.firebaseapp.com','https://appassets.androidplatform.net']);
const random=n=>{const a=new Uint32Array(1),limit=Math.floor(0x100000000/n)*n;do{crypto.getRandomValues(a);}while(a[0]>=limit);return a[0]%n;};
const id=()=>crypto.randomUUID().replaceAll('-',''),code=()=>Array.from({length:8},()=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[random(32)]).join('');
export default {async fetch(request,env){
 const origin=request.headers.get('Origin'),headers={'Cache-Control':'no-store','Vary':'Origin'};
 if(origin&&!origins.has(origin)&&!(env.FIREBASE_PROJECT_ID?.startsWith('demo-')&&/^http:\/\/(localhost|127\.0\.0\.1):[0-9]+$/.test(origin)))return Response.json({error:'Origin not allowed'},{status:403,headers});
 if(origin)Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Expose-Headers':'Server-Timing, X-Request-ID, Retry-After'});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(!(request.method==='GET'&&new URL(request.url).pathname==='/kaliSocket')&&(request.method!=='POST'||!['/kaliApi','/kaliConsumeExchange'].includes(new URL(request.url).pathname)))return Response.json({error:'POST required'},{status:405,headers});
 if(Number(request.headers.get('Content-Length')||0)>16384)return new Response(null,{status:413,headers});
 let response;try{response=await liveRoute(request,env)||await env.KALI_COORDINATOR.getByName('prototype-v1').fetch(request);}catch(e){response=failure(e);}
 if(response.status===101)return new Response(null,{status:101,webSocket:response.webSocket,headers:response.headers});
 const output=new Response(response.body,response);for(const [k,v]of Object.entries(headers))output.headers.set(k,v);return output;
}};
export class KaliCoordinator extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.env=env;this.storage=ctx.storage;this.identity=new Identity(env);this.db=new Firestore(env.FIREBASE_PROJECT_ID,()=>this.identity.token());this.locks=new KeyedQueue();this.slots=new Slots(4);this.runningRooms=new Set();this.taskContext=ctx;
  this.store=new GameStore(this.db,(...args)=>this.track(...args),(id,active)=>this.trackDeletion(id,active));this.service=new serviceModule.GameService(this.store,{random,id,code});this.alarmRetryAfter=0;
  ctx.blockConcurrencyWhile(async()=>{
   const rooms=await this.storage.list({prefix:'room:'});
   this.alarmRetryAfter=await this.storage.get('alarmRetryAfter')||0;
   for(const [key,r]of rooms)await this.storage.put(key,{id:r.id,recover:true});
   if(rooms.size||(await this.storage.list({prefix:'delete:'})).size)await this.storage.setAlarm(Math.max(Date.now()+100,this.alarmRetryAfter));
  });
 }
 context(timings){
  const db=new Firestore(this.env.FIREBASE_PROJECT_ID,()=>this.identity.token(),undefined,{timings});
  const store=new GameStore(db,(...args)=>this.track(...args),(id,active)=>this.trackDeletion(id,active));
  const create=store.create.bind(store);store.create=(room,...args)=>this.locks.run('room:'+room.id,()=>create(room,...args),timings);
  return {db,service:new serviceModule.GameService(store,{random,id,code}),store};
 }
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
 async arm(){return this.locks.run(':schedule',async()=>{
  const rooms=await this.storage.list({prefix:'room:'}),retries=await this.storage.list({prefix:'retry:'}),scans=await this.storage.list({prefix:'scan:'});let at=Infinity;
  const deletions=await this.storage.list({prefix:'delete:'});
  for(const r of rooms.values()){
   const interval=R.active(r)&&!r.paused?5000:30000;
   let due=(scans.get('scan:'+r.id)||0)+interval;
   if(!r.paused&&R.active(r)&&r.hand.deadline!==null)due=Math.min(due,r.hand.deadline);
   if(deletions.has('delete:'+r.id))due=Math.min(due,Date.now()+1000);
   if(this.runningRooms.has(r.id))due=Math.max(due,Date.now()+1000);
   at=Math.min(at,Math.max(due,retries.get('retry:'+r.id)?.until||0));
  }
  for(const {id}of deletions.values())at=Math.min(at,Math.max(Date.now()+1000,retries.get('retry:'+id)?.until||0));
  if(Number.isFinite(at))await this.setEarlierAlarm(Math.max(Date.now()+100,at,this.alarmRetryAfter,Date.now()+(quotaError(this.env.FIREBASE_PROJECT_ID)?.retryAfter||0)*1000));
 });}
 async setEarlierAlarm(at){const old=await this.storage.getAlarm();if(old===null||old>at)await this.storage.setAlarm(at);}
 async cleanupAlarm(at){return this.locks.run(':schedule',()=>this.setEarlierAlarm(Math.max(at,this.alarmRetryAfter)));}
 async rate(key){const now=Date.now(),k='limit:'+key;await this.storage.transaction(async tx=>{const old=await tx.get(k),same=old&&now-old.at<60000,count=same?old.count+1:1;if(count>90)throw Error('Too many requests; try again shortly');await tx.put(k,{at:same?old.at:now,count});});await this.cleanupAlarm(now+60000);}
 async fetch(request){const timings=new Timings(),requestId=crypto.randomUUID();
  try{
   const text=await request.text();if(text.length>16384)throw Error('Request too large');const body=JSON.parse(text);
   const blocked=quotaError(this.env.FIREBASE_PROJECT_ID);if(blocked&&new URL(request.url).pathname!=='/kaliConsumeExchange'&&!['exchange','clock'].includes(body.operation))throw blocked;
   let result;
   if(new URL(request.url).pathname==='/kaliConsumeExchange'){
    if(typeof body.exchange!=='string'||!/^[a-f0-9]{64}$/.test(body.exchange))throw Error('Invalid exchange');
    const value=await this.storage.transaction(async tx=>{const key='exchange:'+body.exchange,v=await tx.get(key);if(!v||v.expiresAt<Date.now())throw Error('Exchange expired');await tx.delete(key);return v;});result={token:await this.identity.customToken(value.uid)};
   }else{
    const token=/^Bearer (.+)$/.exec(request.headers.get('Authorization')||'');if(!token)throw Error('Sign in required');
    const who=await timings.measure('auth',()=>this.identity.verify(token[1]));await this.rate(who.uid);
    const {db,service,store}=this.context(timings);
    // Room actions use canonical room ownership, not the global tracker role.
    // Keep token revocation checks on every request; only avoid irrelevant reads.
    if(['create','sessionHistory','register'].includes(body.operation))who.admin=who.admin||!!await db.get('admins/'+who.uid);
    let roomId=body.operation==='sessionHistory'?body.sessionId:['create','register','exchange','clock'].includes(body.operation)?null:body.roomId;
    if(!body.operation&&body.action?.type==='join'&&!roomId){roomId=await store.lookup(String(body.code||'').trim().toUpperCase());body.roomId=roomId;}
    if(roomId&&!/^[a-zA-Z0-9_-]{1,100}$/.test(roomId))throw Error('Invalid room');
    const execute=async()=>{
    if(body.operation==='create')result=await service.create(who,body);
    else if(body.operation==='sessionHistory')result=await service.history(who,body);
    else if(body.operation==='clock')result={serverNow:Date.now()};
    else if(body.operation==='presenceSync'){
     if(!/^[a-zA-Z0-9_-]{1,100}$/.test(body.roomId||''))throw Error('Invalid room');
     if(!await db.get('onlineRooms/'+body.roomId+'/members/'+who.uid))throw Error('Room admission required');
     const connections=await timings.measure('presence',()=>this.realtime('/onlinePresence/'+body.roomId+'/'+who.uid+'/connections'));
     const connected=Object.keys(connections||{}).length>0;
     await service.presence(body.roomId,who.uid,connected);result={connected};
    }
    else if(body.operation==='presenceAccess'){
     if(!/^[a-zA-Z0-9_-]{1,100}$/.test(body.roomId||''))throw Error('Invalid room');
     if(!await db.get('onlineRooms/'+body.roomId+'/members/'+who.uid))throw Error('Room admission required');
     await timings.measure('presence',()=>this.realtime('/onlineAcl/'+body.roomId+'/'+who.uid,'PUT',true));await this.track(body.roomId);result={ok:true};
    }else if(body.operation==='register'){
     if(!who.admin)throw Error('Admin access required');const name=String(body.name||'').trim();if(!name||name.length>60)throw Error('Invalid name');const playerId=id();
     await db.request(':commit','POST',{writes:[db.set('players/'+playerId,{name,active:true,createdAt:new Date()},true)]});result={playerId};
    }else if(body.operation==='exchange'){
     const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);const exchange=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
     await this.storage.put('exchange:'+exchange,{uid:who.uid,expiresAt:Date.now()+30000});await this.cleanupAlarm(Date.now()+31000);result={exchange};
    }else result=await service.execute(who,body);

    };
    if(roomId)await this.locks.run('room:'+roomId,execute,timings);else await execute();
   }return Response.json({...result,serverNow:Date.now()},{headers:timings.headers(requestId)});
  }catch(e){return failure(e,timings.headers(requestId));}
 }
 async realtime(path,method='GET',value){
  const url=`https://${this.env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com${path}.json`,res=await fetch(url,{method,headers:{Authorization:'Bearer '+await this.identity.token(),'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(value)}),signal:AbortSignal.timeout(10000)});
  if(!res.ok)throw Error('Presence sync unavailable');return res.json();
 }
 async alarm(){
  if(this.alarmFlight)return this.alarmFlight;
  this.alarmFlight=this.runAlarm();try{return await this.alarmFlight;}finally{this.alarmFlight=null;}
 }
 async runAlarm(){
  const blocked=quotaError(this.env.FIREBASE_PROJECT_ID);if(blocked){await this.storage.setAlarm(Date.now()+blocked.retryAfter*1000);return;}
  const rooms=await this.storage.list({prefix:'room:'}),deletions=await this.storage.list({prefix:'delete:'}),ids=new Set([...rooms.values(),...deletions.values()].map(r=>r.id));
  for(const id of ids){
   if(this.runningRooms.has(id))continue;this.runningRooms.add(id);
   const job=this.locks.run('room:'+id,()=>this.slots.run(async()=>{
   const retry=await this.storage.get('retry:'+id);if(retry?.until>Date.now())return;
   try{
    if(deletions.has('delete:'+id))await this.store.deletion.step(id);
    const key='room:'+id,cached=await this.storage.get(key);if(cached){
     let room=cached.recover?await this.db.get('onlineState/'+id):cached;
     if(!room||room.status==='stopped'){await this.storage.delete(key);await this.storage.delete('scan:'+id);}
     else{
      if(cached.recover)await this.storage.put(key,room);
      const last=await this.storage.get('scan:'+id)||0,interval=R.active(room)&&!room.paused?5000:30000;
      if(Date.now()-last>=interval){
       const presence=await this.realtime('/onlinePresence/'+id);
       // Fetch and application share this room's queue, so a newer explicit sync
       // cannot be overwritten by a stale scan. A failed read never means offline.
       for(const p of Object.values(room.members))if(p.kind==='human'&&!p.reservation&&p.status!=='Removed'){
        const connected=Object.keys(presence?.[p.uid]?.connections||{}).length>0;
        if(p.connected!==connected||connected&&p.status==='Disconnected')await this.service.presence(id,p.uid,connected);
       }
       await this.storage.put('scan:'+id,Date.now());
      }
      room=await this.storage.get(key)||room;
      if(R.active(room)&&!room.paused&&room.hand.deadline!==null&&Date.now()>=room.hand.deadline)await this.service.due(id,room.hand.id,room.hand.turnGeneration);
     }
    }
    await this.storage.delete('retry:'+id);
   }catch(e){console.error('Room alarm failed; bounded retry',e?.code||e?.name||'Error');await this.storage.put('retry:'+id,{until:Date.now()+5000});}
  })).finally(async()=>{this.runningRooms.delete(id);await this.arm();});
   // Do not keep the shared alarm event waiting for a stalled room. A persisted
   // watchdog remains armed; independent rooms can run their next timer event.
   this.taskContext.waitUntil(job.catch(async e=>{console.error('Room task retry',e?.name||'Error');await this.storage.put('retry:'+id,{until:Date.now()+5000});await this.arm();}));
  }
  // Cleanup only ephemeral records under transactions: never erase a concurrent refresh.
  for(const prefix of ['exchange:','limit:'])for(const [key]of await this.storage.list({prefix}))await this.storage.transaction(async tx=>{const v=await tx.get(key);if(v&&(v.expiresAt||v.at+60000)<Date.now())await tx.delete(key);});
  if(this.alarmRetryAfter){this.alarmRetryAfter=0;await this.storage.delete('alarmRetryAfter');}
  await this.arm();
 }
}
