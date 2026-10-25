import {DurableObject} from 'cloudflare:workers';
import {LiveStore} from './live-store.mjs';
import {Firestore} from './firestore.mjs';
import {Identity} from './identity.mjs';
import {exportResult} from './live-export.mjs';
import {KeyedQueue} from './coordination.mjs';
import {failure} from './errors.mjs';
import serviceModule from '../../functions/online/service.js';
import R from '../../functions/online/shared/engine.js';
import metadata from '../../functions/online/metadata.js';
import deletion from '../../functions/online/deletion.js';
const random=n=>{const a=new Uint32Array(1),limit=Math.floor(0x100000000/n)*n;do{crypto.getRandomValues(a);}while(a[0]>=limit);return a[0]%n;};
export class KaliLiveRoom extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.ctx=ctx;this.env=env;this.store=new LiveStore(ctx.storage);this.queue=new KeyedQueue();this.identity=new Identity(env);this.db=new Firestore(env.FIREBASE_PROJECT_ID,()=>this.identity.token());this.service=new serviceModule.GameService(this.store,{clock:Date.now,id:()=>crypto.randomUUID().replaceAll('-',''),random});this.flushing=false;
  ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));
 }
 room(){return this.store.read('room');}
 allowed(uid){const r=this.room(),p=r?.members[uid];if(!p||p.reservation||p.status==='Removed'||this.store.read('deleted')?.complete)throw Error('Not a room participant');return r;}
 view(uid){const room=this.allowed(uid);return {room:R.publicState(room),own:R.privateState(room,uid),pendingExports:this.store.pending(),serverNow:Date.now()};}
 async fetch(request){try{
  if(request.headers.get('Upgrade')?.toLowerCase()==='websocket')return await this.connect(request);
  const {who,body}=await request.json();if(!who?.uid)throw Error('Sign in required');
  return await this.queue.run('state',async()=>{
   let result;
   if(body.operation==='init'){
    if(!who.admin)throw Error('Admin access required');const existing=this.room();if(existing){if(existing.admin!==who.uid||this.store.read('createFingerprint')!==body.createFingerprint)throw Error('Room already exists with different parameters');return Response.json({roomId:existing.id,code:existing.code,transport:'cloudflare-v2'});}
    this.store.storage.transactionSync(()=>{this.store.write('profiles',body.profiles);this.store.write('createFingerprint',body.createFingerprint);});
    await this.store.create(body.room);result={roomId:body.room.id,code:body.room.code,transport:'cloudflare-v2'};
   }else if(body.operation==='snapshot'){result=this.view(who.uid);
   }else if(body.operation==='liveProfiles'){result={profiles:Object.entries(this.store.read('profiles')||{}).map(([id,p])=>({id,name:p.name}))};
   }else if(body.operation==='liveStats'){if(this.room()?.admin!==who.uid)throw Error('Admin access required');result={sqlite:{...this.store.metrics}};
   }else if(body.operation==='socketTicket'){
    this.allowed(who.uid);const ticket=crypto.randomUUID().replaceAll('-','');this.store.write('ticket:'+ticket,{uid:who.uid,until:Date.now()+30000});result={ticket,roomId:this.room().id};
   }else if(body.operation==='liveHistory'){
    this.allowed(who.uid);result={records:this.store.history(Number(body.before)||2147483647,25)};
   }else if(body.operation==='sessionHistory'){
    result=await this.history(who,body);
   }else if(body.operation==='liveDirectory'){
    const r=this.allowed(who.uid);result={roomId:r.id,code:r.code,sessionName:r.sessionName,status:r.status,transport:r.transport};
   }else{
    if(body.operation)throw Error('Unsupported live operation');
    result=await this.service.execute(who,body);
   }
   await this.arm();this.broadcast();this.flushSoon();return Response.json({...result,serverNow:Date.now()});
  });
 }catch(e){return failure(e);}}
 async connect(request){return this.queue.run('state',async()=>{
  const protocol=request.headers.get('Sec-WebSocket-Protocol')||'',ticket=protocol.split(',').map(s=>s.trim()).find(s=>s.startsWith('ticket.'))?.slice(7);
  if(!/^[a-f0-9]{32}$/.test(ticket||''))throw Error('Invalid connection ticket');
  const saved=this.store.read('ticket:'+ticket);if(!saved||saved.until<Date.now())throw Error('Connection ticket expired');this.allowed(saved.uid);
  this.store.sql.exec('DELETE FROM live_meta WHERE key=?','ticket:'+ticket);
  const pair=new WebSocketPair(),[client,socket]=Object.values(pair);this.ctx.acceptWebSocket(socket,[saved.uid]);socket.serializeAttachment({uid:saved.uid,seen:Date.now(),expires:Date.now()+300000});
  await this.service.presence(this.room().id,saved.uid,true);await this.arm();this.broadcast();
  return new Response(null,{status:101,webSocket:client,headers:{'Sec-WebSocket-Protocol':'kali.v2'}});
 });}
 broadcast(){for(const ws of this.ctx.getWebSockets()){try{const {uid}=ws.deserializeAttachment();ws.send(JSON.stringify({type:'state',...this.view(uid)}));}catch{try{ws.close(4003,'Room access removed');}catch{}}}}
 async webSocketMessage(ws,message){if(message==='ping')return;try{ws.close(1008,'Use authenticated command endpoint');}catch{}}
 async webSocketClose(ws){const info=ws.deserializeAttachment();try{ws.close(1000,'Closed');}catch{}await this.queue.run('state',async()=>{if(info&&!this.ctx.getWebSockets(info.uid).some(s=>s!==ws&&s.readyState===1)&&this.room()&&!this.store.read('deleted'))await this.service.presence(this.room().id,info.uid,false);await this.arm();this.broadcast();});}
 async webSocketError(ws){await this.webSocketClose(ws);}
 async arm(){
  const r=this.room(),job=this.store.nextExport();let at=Infinity,now=Date.now();
  if(r&&!this.store.read('deleted')){if(R.active(r)&&!r.paused&&r.hand.deadline!==null)at=r.hand.deadline;if(this.ctx.getWebSockets().length)at=Math.min(at,now+30000);}
  if(job&&!this.store.read('deleted'))at=Math.min(at,Math.max(now+1000,job.due));
  if(this.store.read('deleted')&&!this.store.read('deleted').complete)at=Math.min(at,Math.max(now+1000,this.store.read('deleteRetry')||0));
  if(Number.isFinite(at))await this.ctx.storage.setAlarm(Math.max(now+50,at));else await this.ctx.storage.deleteAlarm();
 }
 async alarm(){
  await this.queue.run('state',async()=>{
   const now=Date.now(),r=this.room();if(r&&!this.store.read('deleted')){
    const expired=new Set();for(const ws of this.ctx.getWebSockets()){const a=ws.deserializeAttachment(),last=this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime()||a.seen;if(a.expires<=now||now-last>=30000){expired.add(a.uid);try{ws.close(4001,'Reconnect required');}catch{}}}
    for(const uid of expired)if(!this.ctx.getWebSockets(uid).some(ws=>{const a=ws.deserializeAttachment();return a.expires>now&&now-(this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime()||a.seen)<30000;}))await this.service.presence(r.id,uid,false);
    const current=this.room(),h=current.hand;if(R.active(current)&&!current.paused&&h.deadline!==null&&h.deadline<=now)await this.service.due(current.id,h.id,h.turnGeneration);
   }await this.arm();this.broadcast();
  });await this.flush();
 }
 flushSoon(){if(!this.flushing)this.ctx.waitUntil(this.flush());}
 async flush(){if(this.flushing)return;this.flushing=true;try{
  if(this.store.read('deleted')){await this.drainDelete();return;}
  const job=this.store.nextExport();if(!job||job.due>Date.now())return;
  try{await exportResult(this.db,job.payload);await this.queue.run('state',()=>{this.store.ack(job.seq);this.broadcast();});}
  catch(e){const delay=e.code==='RESOURCE_EXHAUSTED'?300000:Math.min(300000,1000*2**Math.min(job.attempts,8));this.store.defer(job,Date.now(),delay);}
 }finally{this.flushing=false;await this.arm();}}
 async history(who,b){const r=this.room();if(who.uid!==r.admin&&!who.admin)throw Error('Admin access required');if(r.status!=='stopped')throw Error('Stop the online session before editing its history');
  if(b.action==='rename'){
   const name=String(b.name||'').trim();if(!name||name.length>80)throw Error('Invalid session name');if(b.expectedName!=null&&b.expectedName!==r.sessionName)throw Error('Session name changed. Refresh and retry.');
   return this.store.transact(r.id,who.uid+'_'+b.commandId,JSON.stringify(b),before=>{const next={...before,sessionName:name,revision:before.revision+1};return {next,result:{ok:true}};});
  }
  const d=new deletion.SessionDeletion(this.db),saved=await this.db.get('sessions/'+r.id);
  if(b.action==='previewDelete'){
   const published=saved?await d.preview(r.id,b.expectedName??null):{roundCount:0,impacts:[]},token=await deletion.digest({revision:r.revision,published,total:r.completed});this.store.write('deletePreview',{token,revision:r.revision,published});return {...published,previewToken:token,pendingExports:this.store.pending(),totalCompleted:r.completed};
  }
  if(b.action!=='delete'||b.deleteRounds!==true)throw Error('Update the app: deletion removes rounds and points');
  const old=this.store.read('deleted');if(old)return {ok:old.complete===true,pending:!old.complete,deletedRounds:r.completed};
  const preview=this.store.read('deletePreview');if(!preview||preview.token!==b.previewToken||preview.revision!==r.revision)throw Error('Deletion confirmation changed. Refresh and retry.');
  const current=saved?await d.preview(r.id,b.expectedName??null):{roundCount:0,impacts:[]};if(await deletion.digest(current)!==await deletion.digest(preview.published))throw Error('Exported history changed. Review deletion again.');
  this.store.write('deleted',{complete:false,at:Date.now(),total:r.completed});return {pending:true};
 }
 async drainDelete(){const r=this.room(),state=this.store.read('deleted');if(!state||state.complete||(this.store.read('deleteRetry')||0)>Date.now())return;
  try{
   await this.db.transaction(async tx=>{const [t,s]=await Promise.all([this.db.get('onlineTombstones/'+r.id,tx),this.db.get('sessions/'+r.id,tx)]);const writes=[];if(!t)writes.push(this.db.set('onlineTombstones/'+r.id,{at:new Date(state.at),roomId:r.id},true));if(!s)writes.push(this.db.set('sessions/'+r.id,metadata.sessionRecord(r)));return {writes,result:null};});
   const d=new deletion.SessionDeletion(this.db),job=await this.db.get('sessionDeletions/'+r.id);let result;
   if(job)result=await d.step(r.id);else{const preview=await d.preview(r.id,null);result=await d.execute(r.admin,{sessionId:r.id,previewToken:preview.previewToken,expectedName:null});}
   if(!result.pending)this.store.storage.transactionSync(()=>{this.store.write('deleted',{...state,complete:true});this.store.sql.exec('DELETE FROM live_outbox');this.store.sql.exec('DELETE FROM live_hands');});
  }catch{this.store.write('deleteRetry',Date.now()+300000);}
 }
}
