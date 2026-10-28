import {scoreboard} from './scoreboard.mjs';
import {DurableObject} from 'cloudflare:workers';
import {LiveStore} from './live-store.mjs';
import {Firestore} from './firestore.mjs';
import {Identity} from './identity.mjs';
import {exportResult} from './live-export.mjs';
import {KeyedQueue} from './coordination.mjs';
import {progress,diagnosticEnabled} from './progress.mjs';
import {failure} from './errors.mjs';
import serviceModule from '../../functions/online/service.js';
import R from '../../functions/online/shared/engine.js';
import metadata from '../../functions/online/metadata.js';
import deletion from '../../functions/online/deletion.js';
const random=n=>{const a=new Uint32Array(1),limit=Math.floor(0x100000000/n)*n;do{crypto.getRandomValues(a);}while(a[0]>=limit);return a[0]%n;};
export class KaliLiveRoom extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.ctx=ctx;this.env=env;this.store=new LiveStore(ctx.storage);this.queue=new KeyedQueue();this.exports=new KeyedQueue();this.alarmMetrics={reads:0,writes:0,deleteSlices:0};this.identity=new Identity(env);this.db=new Firestore(env.FIREBASE_PROJECT_ID,()=>this.identity.token());this.service=new serviceModule.GameService(this.store,{clock:Date.now,id:()=>crypto.randomUUID().replaceAll('-',''),random});this.flushing=false;
  ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));
 }
 room(){return this.store.read('room');}
 allowed(uid){const r=this.room(),p=r?.members[uid];if(this.store.read('deleted')?.complete)throw Error('Session was deleted');if(!p||p.reservation||p.status==='Removed')throw Error('Not a room participant');return r;}
 view(uid,scope){const room=this.allowed(uid);if(scope==='scores')return {scoreboard:scoreboard(room,this.store.pending()),serverNow:Date.now()};return {room:R.publicState(room),own:R.privateState(room,uid),pendingExports:this.store.pending(),serverNow:Date.now()};}
 async fetch(request){try{
  if(request.headers.get('Upgrade')?.toLowerCase()==='websocket')return await this.connect(request);
  const {who,body,profile}=await request.json();if(!who?.uid)throw Error('Sign in required');
  return await this.queue.run('state',async()=>{
   this.store.storage.transactionSync(()=>{const key='rate:'+who.uid,old=this.store.read(key),now=Date.now(),same=old&&now-old.at<60000,count=same?old.count+1:1;if(count>90){const e=Error('Too many requests. Retry shortly.');e.status=429;e.retryAfter=Math.max(1,Math.ceil((old.at+60000-now)/1000));throw e;}this.store.write(key,{at:same?old.at:now,count});});
   if(profile&&profile.id===body.action?.playerId)this.store.write('profiles',{...this.store.read('profiles'),[profile.id]:profile.value});
   let result;
   if(body.operation==='hasProfile'){result={known:!!this.store.read('profiles')?.[body.playerId],owner:this.room()?.admin===who.uid};
   }else if(body.operation==='creationReceipt'){const r=this.room();if(!r||r.admin!==who.uid||this.store.read('createFingerprint')!==body.fingerprint)throw Error('Room creation parameters changed');result={roomId:r.id,code:r.code,transport:'cloudflare-v2'};
   }else if(body.operation==='init'){
    if(!who.admin)throw Error('Admin access required');const existing=this.room();if(existing){if(existing.admin!==who.uid||this.store.read('createFingerprint')!==body.createFingerprint)throw Error('Room already exists with different parameters');return Response.json({roomId:existing.id,code:existing.code,transport:'cloudflare-v2'});}
    this.store.storage.transactionSync(()=>{this.store.write('profiles',body.profiles);this.store.write('createFingerprint',body.createFingerprint);});
    body.room.members[body.room.admin].connected=false;body.room.members[body.room.admin].status='Disconnected';await this.store.create(body.room);result={roomId:body.room.id,code:body.room.code,transport:'cloudflare-v2'};
   }else if(body.operation==='snapshot'){result=this.view(who.uid);
   }else if(body.operation==='liveProfiles'){result={profiles:Object.entries(this.store.read('profiles')||{}).map(([id,p])=>({id,name:p.name}))};
   }else if(body.operation==='liveStats'){if(this.room()?.admin!==who.uid)throw Error('Admin access required');result={sqlite:{...this.store.metrics},alarmApi:{...this.alarmMetrics}};
   }else if(['socketTicket','scoreboardTicket'].includes(body.operation)){
    this.allowed(who.uid);const ticket=crypto.randomUUID().replaceAll('-','');this.store.write('ticket:'+ticket,{uid:who.uid,until:Date.now()+30000,scope:body.operation==='scoreboardTicket'?'scores':'game'});result={ticket,roomId:this.room().id};
   }else if(body.operation==='liveHistory'){
    this.allowed(who.uid);result={records:this.store.history(Number.isSafeInteger(body.before)?Math.max(0,body.before):2147483647,25)};
   }else if(body.operation==='sessionHistory'){
    result=await this.history(who,body);
   }else if(body.operation==='liveDirectory'){
    const r=this.allowed(who.uid);result={roomId:r.id,code:r.code,sessionName:r.sessionName,status:r.status,transport:r.transport,revision:r.revision,startTime:r.startedAt||r.createdAt,endTime:r.endedAt||null,source:'online',scoreboard:body.includeScores?scoreboard(r,this.store.pending()):undefined};
   }else{
    if(body.operation)throw Error('Unsupported live operation');
    result=await this.service.execute(who,body);if(body.action?.type==='join'&&!this.ctx.getWebSockets(who.uid).some(ws=>ws.readyState===1))await this.service.presence(this.room().id,who.uid,false);
   }
   await this.arm();this.broadcast();this.flushSoon();return Response.json({...result,serverNow:Date.now()});
  });
 }catch(e){return failure(e);}}
 async connect(request){return this.queue.run('state',async()=>{
  const protocol=request.headers.get('Sec-WebSocket-Protocol')||'',ticket=protocol.split(',').map(s=>s.trim()).find(s=>s.startsWith('ticket.'))?.slice(7);
  if(!/^[a-f0-9]{32}$/.test(ticket||''))throw Error('Invalid connection ticket');
  const saved=this.store.read('ticket:'+ticket);if(!saved||saved.until<Date.now())throw Error('Connection ticket expired');this.allowed(saved.uid);
  this.store.sql.exec('DELETE FROM live_meta WHERE key=?','ticket:'+ticket);
  const pair=new WebSocketPair(),[client,socket]=Object.values(pair);this.ctx.acceptWebSocket(socket,[saved.scope==='scores'?'scores:'+saved.uid:saved.uid]);socket.serializeAttachment({uid:saved.uid,scope:saved.scope||'game',seen:Date.now(),expires:Date.now()+300000});
  if(saved.scope!=='scores')await this.service.presence(this.room().id,saved.uid,true);await this.arm();this.broadcast();
  return new Response(null,{status:101,webSocket:client,headers:{'Sec-WebSocket-Protocol':'kali.v2'}});
 });}
 broadcast(){for(const ws of this.ctx.getWebSockets()){try{const attachment=ws.deserializeAttachment(),{uid,scope}=attachment;if(scope==='scores'){const key=(this.room().scoreboardRevision||0)+':'+this.store.pending();if(attachment.scoreKey===key)continue;attachment.scoreKey=key;ws.serializeAttachment(attachment);}ws.send(JSON.stringify({type:'state',...this.view(uid,scope)}));}catch{try{ws.close(this.store.read('deleted')?.complete?4004:4003,'Room access removed');}catch{}}}}
 async webSocketMessage(ws,message){if(message==='ping')return;try{ws.close(1008,'Use authenticated command endpoint');}catch{}}
 async webSocketClose(ws){const info=ws.deserializeAttachment();if(info?.scope==='scores'){try{ws.close(1000,'Closed');}catch{}return;}try{ws.close(1000,'Closed');}catch{}await this.queue.run('state',async()=>{if(info&&!this.ctx.getWebSockets(info.uid).some(s=>s!==ws&&s.readyState===1)&&this.room()&&!this.store.read('deleted'))await this.service.presence(this.room().id,info.uid,false);await this.arm();this.broadcast();});}
 async webSocketError(ws){await this.webSocketClose(ws);}
 async arm(){
  const r=this.room(),job=this.store.nextExport();let at=Infinity,now=Date.now();
  if(r&&!this.store.read('deleted')){if(R.active(r)&&!r.paused&&r.hand.deadline!==null)at=r.hand.deadline;const sockets=this.ctx.getWebSockets().filter(ws=>ws.readyState===1);if(sockets.length)at=Math.min(at,r.status==='stopped'||sockets.every(ws=>ws.deserializeAttachment().scope==='scores')?Math.min(...sockets.map(ws=>ws.deserializeAttachment().expires)):now+30000);}
  if(this.store.sql.exec("SELECT 1 FROM live_meta WHERE key >= 'ticket:' AND key < 'ticket;' LIMIT 1").length)at=Math.min(at,now+30000);
  // A durable safety wake survives a crash during background IO, without waking
  // once per second while that same export is still in flight. Live deadlines
  // always take priority over this retry wake.
  const backgroundWake=this.flushing?now+30000:now+1000;
  if(this.store.read('directoryDirty')!==null)at=Math.min(at,Math.max(backgroundWake,this.store.read('directoryRetry')||0));
  if(job&&!this.store.read('deleted'))at=Math.min(at,Math.max(backgroundWake,job.due));
  if(this.store.read('deleted')&&!this.store.read('deleted').complete)at=Math.min(at,Math.max(backgroundWake,this.store.read('deleteRetry')||0));
  this.alarmMetrics.reads++;const old=await this.ctx.storage.getAlarm();let scheduled=old;if(Number.isFinite(at)){const target=Math.max(now+50,at);if(old===null||old>target){await this.ctx.storage.setAlarm(target);this.alarmMetrics.writes++;scheduled=target;}}else if(old!==null){await this.ctx.storage.deleteAlarm();this.alarmMetrics.writes++;scheduled=null;}
  if(diagnosticEnabled(this.env.ROOM_PROGRESS_DIAGNOSTIC,r,now))console.info('KALI_ROOM_PROGRESS',JSON.stringify(progress(r,now,{alarmAt:scheduled,exporting:this.flushing,pending:job})));
 }
 async alarm(){
  await this.queue.run('state',async()=>{
   const now=Date.now(),r=this.room();this.store.sql.exec("DELETE FROM live_meta WHERE key IN (SELECT key FROM live_meta WHERE key >= 'ticket:' AND key < 'ticket;' AND CAST(json_extract(value,'$.until') AS INTEGER) < ? LIMIT 25)",now);if(r&&!this.store.read('deleted')){
    const expired=new Set();for(const ws of this.ctx.getWebSockets()){const a=ws.deserializeAttachment(),last=this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime()||a.seen;if(a.expires<=now||a.scope!=='scores'&&now-last>=30000){if(a.scope!=='scores')expired.add(a.uid);try{ws.close(4001,'Reconnect required');}catch{}}}
    for(const uid of expired)if(!this.ctx.getWebSockets(uid).some(ws=>{const a=ws.deserializeAttachment();return a.expires>now&&now-(this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime()||a.seen)<30000;}))await this.service.presence(r.id,uid,false);
    const current=this.room(),h=current.hand;if(R.active(current)&&!current.paused&&h.deadline!==null&&h.deadline<=now)await this.service.due(current.id,h.id,h.turnGeneration);
   }await this.arm();this.broadcast();
  });
  // The next live deadline is already armed. A Firestore export can take several
  // network round trips; do not keep this alarm handler open while it completes.
  // The SQLite outbox remains durable and flush() still serializes/retries export.
  this.flushSoon();
 }
 flushSoon(){if(!this.flushing)this.ctx.waitUntil(this.flush());}
 async flush(){if(this.flushing)return;this.flushing=true;try{await this.exports.run('export',async()=>{
  const dirty=this.store.read('directoryDirty');if(dirty!==null&&(this.store.read('directoryRetry')||0)<=Date.now()){try{const r=this.room();await this.env.KALI_LIVE_DIRECTORY.getByName('directory-v2').fetch(new Request('https://directory/',{method:'POST',body:JSON.stringify({op:'update',id:r.id,status:r.status,revision:r.revision})}));if(this.store.read('directoryDirty')===dirty)this.store.sql.exec('DELETE FROM live_meta WHERE key=?','directoryDirty');}catch{this.store.write('directoryRetry',Date.now()+30000);}}
  if(this.store.read('deleted')){await this.drainDelete();return;}
  const job=this.store.nextExport();if(!job||job.due>Date.now())return;
  try{const outcome=await exportResult(this.db,job.payload);this.store.ack(job.seq);if(outcome.deleted)this.store.write('deleted',{complete:false,at:Date.now()});this.broadcast();}
  catch(e){const delay=e.code==='RESOURCE_EXHAUSTED'?300000:Math.min(300000,1000*2**Math.min(job.attempts,8));this.store.defer(job,Date.now(),delay);}
 });}finally{this.flushing=false;await this.arm();}}
 async history(who,b){
  // Once intent is durably accepted, polling only reads SQLite. Do not queue a
  // confirmation behind Firestore cleanup; keep the same authorization checks.
  if(b.action==='delete'&&this.store.read('deleted'))return this.historyLocked(who,b);
  return this.exports.run('export',()=>this.historyLocked(who,b));
 }
 async publishedPreview(r,b,d){return this.db.transaction(async tx=>{const saved=await this.db.get('sessions/'+r.id,tx);if(!saved)return {writes:[],result:{roundCount:0,impacts:[]}};const snapshot={...saved,endTime:saved.endTime||new Date(r.endedAt)};Object.defineProperty(snapshot,'_cascadeVersion',{value:saved._cascadeVersion});const {preview}=await d.describe(r.id,b.expectedName??null,tx,snapshot);return {writes:[],result:preview};});}
 async historyLocked(who,b){if(!/^[a-zA-Z0-9_-]{8,100}$/.test(b.commandId||''))throw Error('Command ID required');const r=this.room();if(who.uid!==r.admin&&!who.admin)throw Error('Admin access required');if(r.status!=='stopped')throw Error('Stop the online session before editing its history');if(b.expectedName!=null&&b.expectedName!==r.sessionName)throw Error('Session name changed. Refresh and retry.');
  if(b.action==='rename'){
   const name=String(b.name||'').trim();if(!name||name.length>80)throw Error('Invalid session name');if(b.expectedName!=null&&b.expectedName!==r.sessionName)throw Error('Session name changed. Refresh and retry.');
   return this.store.transact(r.id,who.uid+'_'+b.commandId,JSON.stringify(b),before=>{const next={...before,sessionName:name,revision:before.revision+1};return {next,result:{ok:true}};});
  }
  if(b.action==='delete'&&this.store.read('deleted')){const old=this.store.read('deleted');return {ok:old.complete===true,pending:!old.complete,deletedRounds:r.completed};}
  const d=new deletion.SessionDeletion(this.db);
  if(b.action==='previewDelete'){
   const published=await this.publishedPreview(r,b,d),token=await deletion.digest({revision:r.revision,published,total:r.completed});this.store.write('deletePreview',{token,revision:r.revision,published});return {...published,publishedRoundCount:published.roundCount,roundCount:r.completed,previewToken:token,pendingExports:this.store.pending(),totalCompleted:r.completed};
  }
  if(b.action!=='delete'||b.deleteRounds!==true)throw Error('Update the app: deletion removes rounds and points');
  const old=this.store.read('deleted');if(old)return {ok:old.complete===true,pending:!old.complete,deletedRounds:r.completed};
  const preview=this.store.read('deletePreview');if(!preview||preview.token!==b.previewToken||preview.revision!==r.revision)throw Error('Deletion confirmation changed. Refresh and retry.');
  const current=await this.publishedPreview(r,b,d);if(await deletion.digest(current)!==await deletion.digest(preview.published))throw Error('Exported history changed. Review deletion again.');
  this.store.write('deleted',{complete:false,at:Date.now(),total:r.completed});return {pending:true};
 }
 async drainDelete(){const r=this.room(),state=this.store.read('deleted');if(!state||state.complete||(this.store.read('deleteRetry')||0)>Date.now())return;this.alarmMetrics.deleteSlices++;
  try{
   await this.db.transaction(async tx=>{const [t,s,j]=await Promise.all([this.db.get('onlineTombstones/'+r.id,tx),this.db.get('sessions/'+r.id,tx),this.db.get('sessionDeletions/'+r.id,tx)]);const writes=[];if(!t)writes.push(this.db.set('onlineTombstones/'+r.id,{at:new Date(state.at),roomId:r.id},true));if(!s&&j?.status!=='complete')writes.push(this.db.set('sessions/'+r.id,metadata.sessionRecord(r)));else if(s&&!s.endTime&&j?.status!=='complete')writes.push(this.db.set('sessions/'+r.id,{...s,endTime:new Date(r.endedAt),status:'stopped'}));return {writes,result:null};});
   const d=new deletion.SessionDeletion(this.db),job=await this.db.get('sessionDeletions/'+r.id);let result;
   const deadline=Date.now()+500;
   if(job)result=await d.step(r.id);else{const preview=await d.preview(r.id,null);result=await d.execute(r.admin,{sessionId:r.id,previewToken:preview.previewToken,expectedName:null});}
   // Each step remains an independent durable transaction. Drain a small slice,
   // rather than waiting for another alarm between empty cleanup phases.
   for(let steps=1;steps<4&&result.pending;steps++){
    // Let the event clock advance before enforcing the wall-time slice.
    await new Promise(resolve=>setTimeout(resolve,0));if(Date.now()>=deadline)break;
    result=await d.step(r.id);
   }
   if(!result.pending)this.store.storage.transactionSync(()=>{this.store.write('deleted',{...state,complete:true});this.store.sql.exec('DELETE FROM live_outbox');this.store.sql.exec('DELETE FROM live_hands');});if(!result.pending)this.broadcast();
  }catch{this.store.write('deleteRetry',Date.now()+300000);}
 }
}
