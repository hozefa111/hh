import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Firestore,encode,decode} from '../firestore.mjs';
import {GameStore} from '../store.mjs';
import R from '../../../functions/online/shared/engine.js';
import B from '../../../functions/online/shared/bot.js';
import S from '../../../functions/online/service.js';
test('REST encoding retains card values, nested hands, empty maps, nulls and Firestore timestamps',()=>{
 const v={name:'A',score:-78,bid:155,hand:['AS','3S'],empty:[],map:{},none:null,ready:true,timestamp:new Date(1000)};
 assert.deepEqual(decode(encode(v)),v);assert.throws(()=>encode(undefined));
});
test('Firestore transaction retries ABORTED but not arbitrary failures',async()=>{
 let commits=0,rollbacks=0;
 const db=new Firestore('demo',async()=>'fake',async(url,init)=>{
  if(url.endsWith(':beginTransaction'))return Response.json({transaction:'t'});
  if(url.endsWith(':rollback')){rollbacks++;return Response.json({});}
  if(url.endsWith(':commit')){commits++;return commits===1?Response.json({error:{status:'ABORTED'}},{status:409}):Response.json({});}
 });
 assert.equal(await db.transaction(async()=>({writes:[],result:42})),42);assert.equal(commits,2);assert.equal(rollbacks,1);
 assert.throws(()=>db.name('players/../admins'),/Invalid/);
});
class RestMemory {
 constructor(){this.docs=new Map;this.calls=[];}
 async fetch(url,init){
  this.calls.push({url,method:init.method});const body=init.body?JSON.parse(init.body):{},suffix=new URL(url).pathname.split('/documents')[1];
  if(suffix===':beginTransaction')return Response.json({transaction:'memory'});
  if(suffix===':rollback')return Response.json({});
  if(suffix===':batchGet')return Response.json([...(body.newTransaction?[{transaction:'memory'}]:[]),...body.documents.map(name=>{const fields=this.docs.get(name.split('/documents/')[1]);return fields?{found:{name,fields}}:{missing:name};})]);
  if(suffix.endsWith(':runQuery')){const q=body.structuredQuery,col=suffix.slice(1,-9),prefix=(col?col+'/':'')+q.from[0].collectionId+'/',after=q.startAt?.values[0].referenceValue.split('/documents/')[1];const docs=[...this.docs.entries()].filter(([k])=>k.startsWith(prefix)&&!k.slice(prefix.length).includes('/')&&(!after||k>after)).sort(([a],[b])=>a<b?-1:a>b?1:0).slice(0,q.limit).map(([k,fields])=>({document:{name:'projects/demo/databases/(default)/documents/'+k,fields}}));return Response.json(docs);}
  if(suffix===':commit'){
   for(const w of body.writes)if(w.currentDocument?.exists===false&&this.docs.has(w.update.name.split('/documents/')[1]))return Response.json({error:{status:'ALREADY_EXISTS'}},{status:409});
   for(const w of body.writes){const key=(w.update?.name||w.delete).split('/documents/')[1];if(w.delete)this.docs.delete(key);else this.docs.set(key,w.update.fields);}
   return Response.json({});
  }
  const fields=this.docs.get(suffix.slice(1));return fields?Response.json({fields}):Response.json({error:{status:'NOT_FOUND'}},{status:404});
 }
 get(path){return this.docs.has(path)?decode({mapValue:{fields:this.docs.get(path)}}):null;}
 put(path,value){this.docs.set(path,encode(value).mapValue.fields);}
}
async function fixture(mode){
 const memory=new RestMemory,db=new Firestore('demo',async()=>'fake',memory.fetch.bind(memory)),rooms=new Map;
 const store=new GameStore(db,async(id,r)=>{if(r)rooms.set(id,r);});memory.put('players/pa',{name:'Human A'});
 let serial=0,now=100000;
 const service=new S.GameService(store,{id:()=> 'identifier_'+(++serial),code:()=> 'ABCDEFGH',clock:()=>now,random:n=>serial++%n});
 const who={uid:'admin',admin:true},{roomId}=await service.create(who,{playerId:'pa',mode});
 const send=(uid,action,extra={})=>service.execute({uid,admin:uid==='admin'},{roomId,revision:rooms.get(roomId).revision,action,commandId:'command_'+(++serial),...extra});
 return {memory,db,store,rooms,service,roomId,who,send,time:v=>now=v};
}
for(const mode of [4,6])test(`${mode}-seat REST adapter completes repeated hands with exact-once unified scores and private projections`,async()=>{
 const f=await fixture(mode);
 for(let seat=2;seat<=mode;seat++)await f.send('admin',{type:'bot',seat});
 for(let n=0;n<6;n++){
  await f.send('admin',{type:'ready'});let steps=0;
  while(R.active(f.rooms.get(f.roomId))){
   assert(++steps<160);const r=f.rooms.get(f.roomId),h=r.hand;
   if(h.deadline!==null){f.time(h.deadline);await f.service.due(r.id,h.id,h.turnGeneration);}
   else await f.send(h.turn,B.decide(R.publicState(r),h.turn,R.privateState(r,h.turn).cards));
  }
  const r=f.rooms.get(f.roomId);assert.equal(r.completed,n+1);assert.equal(r.defaultSeat,1+(n+1)%mode);
  assert.equal(Object.values(r.hand.captured).reduce((a,b)=>a+b),250);
  const rec=f.memory.get('rounds/online_'+r.hand.id);assert.deepEqual(rec.playerIds,['pa']);assert(rec.timestamp instanceof Date);
  const pub=f.memory.get('onlineRooms/'+r.id);assert(!pub.hand.hands);assert(pub.hand.revealed);assert(!('events'in pub));
  assert.equal([...f.memory.docs.keys()].filter(k=>k.startsWith('rounds/')).length,n+1);
  await f.service.due(r.id,r.hand.id,r.hand.turnGeneration);assert.equal([...f.memory.docs.keys()].filter(k=>k.startsWith('rounds/')).length,n+1);
 }
 const all=[...f.memory.docs.keys()].filter(k=>k.startsWith('rounds/')).map(k=>f.memory.get(k));
 assert.equal(f.rooms.get(f.roomId).totals.pa,all.reduce((n,r)=>n+r.scoreChanges.pa,0));
 await f.send('admin',{type:'stop'});const session=f.memory.get('sessions/'+f.roomId);assert.equal(session.totalRounds,6);assert.equal(session.status,'stopped');assert(session.startTime instanceof Date);
});
test('REST receipts reject command mutation; hidden partners do not enter public state before reveal',async()=>{
 const f=await fixture(6),req={roomId:f.roomId,revision:0,commandId:'duplicate_123',action:{type:'bot',seat:2}};
 await f.service.execute(f.who,req);await f.service.execute(f.who,req);assert.equal(f.rooms.get(f.roomId).revision,1);
 await assert.rejects(f.service.execute(f.who,{...req,action:{type:'bot',seat:3}}),/already used/);
 for(let seat=3;seat<=6;seat++)await f.send('admin',{type:'bot',seat});await f.send('admin',{type:'ready'});
 while(f.rooms.get(f.roomId).hand.phase!=='playing'){
  const r=f.rooms.get(f.roomId),h=r.hand;
  await f.send(h.turn,h.phase==='auction'?{type:'bid',...(h.finalBid?{keep:true}:{pass:true})}:B.decide(R.publicState(r),h.turn,R.privateState(r,h.turn).cards));
 }
 const pub=f.memory.get('onlineRooms/'+f.roomId);assert.equal(pub.hand.secret,null);assert.equal(pub.hand.partners,null);assert(!('hands'in pub.hand));
 const own=f.memory.get('onlineRooms/'+f.roomId+'/private/admin');assert.equal(own.cards.length,7);
 f.memory.put('players/pwaiting',{name:'Waiting'});await f.send('waiting',{type:'join',playerId:'pwaiting'});const waiting=f.memory.get('onlineRooms/'+f.roomId+'/private/waiting');assert.deepEqual(waiting.cards,[]);
});
test('a legacy global roster binding does not lock a new device out of a different room',async()=>{
 const f=await fixture(4);f.memory.put('players/pb',{name:'B'});const old={uid:'old-device',playerId:'pb'};f.memory.put('onlineProfileLinks/pb',old);
 await f.send('new-device',{type:'join',playerId:'pb'});await f.send('new-device',{type:'claimSeat',seat:2});
 assert.equal(f.rooms.get(f.roomId).members['new-device'].seat,2);assert.deepEqual(f.memory.get('onlineProfileLinks/pb'),old);assert.equal(f.memory.get('players/pb').name,'B');
 await assert.rejects(f.send('third-device',{type:'join',playerId:'pb'}),/already participating in this room/);
 assert.equal(f.rooms.get(f.roomId).members['new-device'].uid,'new-device');assert.equal(f.memory.get('onlineRooms/'+f.roomId+'/private/third-device'),null);
});

test('session deletion rejects older metadata-only clients before deleting any data',async()=>{const f=await fixture(4);await f.send('admin',{type:'stop'});await assert.rejects(f.service.history(f.who,{sessionId:f.roomId,action:'delete',commandId:'old_client_123'}),/Update the app/);assert(f.memory.get('sessions/'+f.roomId));});

async function cascade(f,sessionId){const preview=await f.service.history(f.who,{sessionId,action:'previewDelete',commandId:'preview_'+crypto.randomUUID()});let result,steps=0;do{assert(++steps<100);result=await f.service.history(f.who,{sessionId,action:'delete',deleteRounds:true,previewToken:preview.previewToken,commandId:'delete_'+crypto.randomUUID()});}while(result.pending);return {preview,result};}
test('large manual cascade removes only its rounds and score contributions; retry/archive/profile preservation',async()=>{
 const f=await fixture(4);f.memory.put('sessions/manual',{sessionName:'Manual',startTime:new Date(1000),endTime:new Date(2000),leaderboard:[{id:'pa',name:'Human A'}]});f.memory.put('sessions/other',{sessionName:'Other',startTime:new Date(3000),endTime:new Date(4000)});
 for(let i=0;i<620;i++)f.memory.put('rounds/r'+String(i).padStart(4,'0'),{sessionId:'manual',scoreChanges:{pa:i%2?-180:360},timestamp:new Date(1500)});
 f.memory.put('rounds/legacy',{scoreChanges:{pa:-78},timestamp:new Date(1500)});f.memory.put('rounds/other',{sessionId:'other',scoreChanges:{pa:999},timestamp:new Date(1500)});f.memory.put('rounds/online_other',{sessionId:'online_other',source:'online',scoreChanges:{pa:300},timestamp:new Date(1500)});
 const before=f.memory.get('rounds/other'),profile=f.memory.get('players/pa');const {preview,result}=await cascade(f,'manual');assert.equal(preview.roundCount,621);assert.equal(preview.impacts[0].lifetimeChange,-(310*180-78));assert.equal(result.deletedRounds,621);
 assert.equal(f.memory.get('sessions/manual'),null);assert.deepEqual(f.memory.get('rounds/other'),before);assert(f.memory.get('rounds/online_other'));assert.deepEqual(f.memory.get('players/pa'),profile);assert.equal(f.memory.get('meta/sessionDeletionLock'),null);
 const done=await f.service.history(f.who,{sessionId:'manual',action:'delete',deleteRounds:true,previewToken:preview.previewToken,commandId:'retry_delete_123'});assert.equal(done.pending,false);assert.equal(done.deletedRounds,621);assert.equal([...f.memory.docs.keys()].filter(k=>k.startsWith('sessionDeletionArchives/')&&k.includes('/rounds/')).length,621);
});
test('online cascade removes unified rounds, room hand history and memberships, preserves another session and human identity',async()=>{
 const f=await fixture(4);await f.send('admin',{type:'stop'});const r=f.rooms.get(f.roomId);f.memory.put('rounds/online_hand',{source:'online',sessionId:f.roomId,scoreChanges:{pa:-155,bot_2:-78},participants:[{playerId:'pa',name:'Human A',kind:'human'},{playerId:'bot_2',name:'Computer',kind:'bot'}]});f.memory.put('onlineRooms/'+f.roomId+'/hands/hand',{scoreChanges:{pa:-155}});f.memory.put('rounds/preserve',{sessionId:'elsewhere',scoreChanges:{pa:123}});
 const {preview,result}=await cascade(f,f.roomId);assert.equal(preview.impacts.length,1);assert.equal(preview.impacts[0].lifetimeChange,155);assert.equal(result.deletedRounds,1);for(const path of ['sessions/'+f.roomId,'rounds/online_hand','onlineRooms/'+f.roomId,'onlineRooms/'+f.roomId+'/hands/hand','onlineMemberships/admin/rooms/'+f.roomId,'onlineRooms/'+f.roomId+'/private/admin'])assert.equal(f.memory.get(path),null,path);assert(f.memory.get('onlineState/'+f.roomId).historyDeleted);assert(f.memory.get('rounds/preserve'));assert(f.memory.get('players/pa'));
});
test('changed preview and overlapping legacy sessions reject before mutation; server resumes after restart',async()=>{
 const f=await fixture(4);f.memory.put('sessions/m',{sessionName:'M',startTime:new Date(1000),endTime:new Date(2000)});f.memory.put('rounds/a',{sessionId:'m',scoreChanges:{pa:100}});const preview=await f.service.history(f.who,{sessionId:'m',action:'previewDelete',commandId:'preview_stale_123'});f.memory.put('rounds/a',{sessionId:'m',scoreChanges:{pa:200}});await assert.rejects(f.service.history(f.who,{sessionId:'m',action:'delete',deleteRounds:true,previewToken:preview.previewToken,commandId:'delete_stale_123'}),/rounds changed/);assert(f.memory.get('rounds/a'));assert.equal(f.memory.get('meta/sessionDeletionLock'),null);
 f.memory.put('rounds/legacy_overlap',{timestamp:new Date(1500),scoreChanges:{pa:1}});f.memory.put('sessions/overlap',{sessionName:'Overlap',startTime:new Date(1200),endTime:new Date(1800)});await assert.rejects(f.service.history(f.who,{sessionId:'m',action:'previewDelete',commandId:'preview_overlap_123'}),/multiple sessions/);f.memory.docs.delete('sessions/overlap');
 const p=await f.service.history(f.who,{sessionId:'m',action:'previewDelete',commandId:'preview_resume_123'});await f.service.history(f.who,{sessionId:'m',action:'delete',deleteRounds:true,previewToken:p.previewToken,commandId:'begin_resume_123'});
 const restarted=new GameStore(f.db,async()=>{});let result;do{result=await restarted.deletion.step('m');}while(result.pending);assert.equal(result.deletedRounds,2);assert.equal(f.memory.get('meta/sessionDeletionLock'),null);
});
test('restored manual history requires a new preview and preserves the earlier recovery archive',async()=>{
 const f=await fixture(4),session={sessionName:'Restored',startTime:new Date(1000),endTime:new Date(2000)};
 f.memory.put('sessions/restored',session);f.memory.put('rounds/restored_round',{sessionId:'restored',scoreChanges:{pa:100}});
 const first=await cascade(f,'restored'),oldJob=f.memory.get('sessionDeletions/restored');
 f.memory.put('sessions/restored',session);f.memory.put('rounds/restored_round',{sessionId:'restored',scoreChanges:{pa:-40}});
 await assert.rejects(f.service.history(f.who,{sessionId:'restored',action:'delete',deleteRounds:true,previewToken:first.preview.previewToken,commandId:'stale_restore_123'}),/rounds changed/);
 assert(f.memory.get('rounds/restored_round'));
 const second=await cascade(f,'restored');assert.equal(second.preview.impacts[0].lifetimeChange,40);
 assert.notEqual(f.memory.get('sessionDeletions/restored').generation,oldJob.generation);
 assert.equal([...f.memory.docs.keys()].filter(k=>k.startsWith('sessionDeletionArchives/restored_')&&k.includes('/rounds/')).length,2);
});

test('REST replacement is atomic, clears former private access and retains a separate human score identity',async()=>{for(const mode of [4,6]){const f=await fixture(mode);f.memory.put('players/pb',{name:'Human B'});await f.send('guest',{type:'join',playerId:'pb'});await f.send('admin',{type:'approve',target:'guest',playerId:'pb'});await f.send('admin',{type:'seat',target:'guest',seat:2});for(let seat=3;seat<=mode;seat++)await f.send('admin',{type:'bot',seat});await f.send('guest',{type:'ready'});await f.send('admin',{type:'ready'});const active=f.rooms.get(f.roomId),oldHand=active.hand.id;assert.equal(f.memory.get('onlineRooms/'+f.roomId+'/private/guest').cards.length,mode===4?10:7);await assert.rejects(f.send('admin',{type:'replaceBot',target:'guest'}),/Void or finish/);await f.service.presence(f.roomId,'guest',false);await f.send('admin',{type:'void'});const before=f.rooms.get(f.roomId);await f.send('admin',{type:'replaceBot',target:'guest',botId:'forged'});const after=f.rooms.get(f.roomId),bot=R.ordered(after).find(p=>p.seat===2);assert.equal(bot.kind,'bot');assert.notEqual(bot.uid,'forged');assert.equal(after.totals.pb,before.totals.pb);assert.equal(after.totals[bot.uid],0);assert.equal(after.defaultSeat,before.defaultSeat);assert.equal(after.completed,0);assert.equal(f.memory.get('rounds/online_'+oldHand),null);assert.equal(f.memory.get('onlineRooms/'+f.roomId+'/private/guest'),null);assert.equal(f.memory.get('onlineRooms/'+f.roomId+'/members/guest'),null);assert.equal(f.memory.get('onlineMemberships/guest/rooms/'+f.roomId).status,'Removed');assert.equal(f.memory.get('players/pb').name,'Human B');}});

for(const mode of [4,6])test(`${mode}-seat REST self-service join/seat links identity and protects private cards`,async()=>{
 const f=await fixture(mode);f.memory.put('players/pb',{name:'Human B'});await f.send('b',{type:'join',playerId:'pb'});
 assert.equal(f.memory.get('onlineRooms/'+f.roomId+'/members/b').uid,'b');assert.equal(f.rooms.get(f.roomId).members.b.approved,true);
 await f.send('b',{type:'claimSeat',seat:2});assert.equal(f.memory.get('onlineRooms/'+f.roomId).members.b.seat,2);
 await f.send('b',{type:'ready'});for(let seat=3;seat<=mode;seat++)await f.send('admin',{type:'bot',seat});await f.send('b',{type:'ready'});await f.send('admin',{type:'ready'});
 const cards=f.memory.get('onlineRooms/'+f.roomId+'/private/b').cards;assert.equal(cards.length,mode===4?10:7);
 f.memory.put('players/pw',{name:'Waiting'});await f.send('w',{type:'join',playerId:'pw'});assert.deepEqual(f.memory.get('onlineRooms/'+f.roomId+'/private/w').cards,[]);
 await assert.rejects(f.send('w',{type:'claimSeat',seat:2}),/locked/);assert.deepEqual(f.memory.get('onlineRooms/'+f.roomId+'/private/b').cards,cards);
});

test('batch transaction reads preserve request order, missing documents and cascade versions',async()=>{
 const db=new Firestore('demo',async()=>'fake',async(url,init)=>{const body=JSON.parse(init.body);assert.equal(body.documents.length,3);assert.equal(body.transaction,'transaction');return Response.json([{found:{name:body.documents[2],fields:encode({name:'Third'}).mapValue.fields,updateTime:'v3'}},{missing:body.documents[1]},{found:{name:body.documents[0],fields:encode({name:'First'}).mapValue.fields,updateTime:'v1'}}]);});
 const rows=await db.getMany(['players/a','players/b','players/c'],'transaction');assert.deepEqual(rows,[{name:'First'},null,{name:'Third'}]);assert.equal(rows[0]._cascadeVersion,'v1');assert.equal(rows[2]._cascadeVersion,'v3');
});
test('a keyed move reads canonical state and its receipt in one atomic batch',async()=>{
 const f=await fixture(4);const start=f.memory.calls.length;await f.send('admin',{type:'bot',seat:2});const calls=f.memory.calls.slice(start),reads=calls.filter(c=>c.url.endsWith(':batchGet'));assert.equal(reads.length,1);assert.equal(calls.filter(c=>c.url.endsWith(':beginTransaction')).length,0);assert.equal(calls.filter(c=>c.url.endsWith(':commit')).length,1);
});

test('hot transactions combine start/read, retry conflicts and never commit without a token',async()=>{
 let commits=0,reads=0,rollbacks=0;
 const db=new Firestore('demo',async()=>'test',async(url,init)=>{const b=JSON.parse(init.body);assert(!url.endsWith(':beginTransaction'));
  if(url.endsWith(':batchGet')){reads++;assert.deepEqual(b.newTransaction,{readWrite:{}});return Response.json([{transaction:'tx'+reads},{found:{name:b.documents[0],fields:encode({score:10}).mapValue.fields}}]);}
  if(url.endsWith(':rollback')){rollbacks++;return Response.json({});}
  if(url.endsWith(':commit')){commits++;assert.equal(b.transaction,'tx'+reads);return commits===1?Response.json({error:{status:'ABORTED'}},{status:409}):Response.json({});}
 });
 const result=await db.transactionRead(['players/test'],async rows=>({writes:[],result:rows[0].score}));assert.equal(result,10);assert.equal(reads,2);assert.equal(commits,2);assert.equal(rollbacks,1);
 let callback=false;const broken=new Firestore('demo',async()=>'test',async(url)=>{assert(url.endsWith(':batchGet'));return Response.json([]);});await assert.rejects(broken.transactionRead(['players/test'],async()=>{callback=true;return{writes:[],result:null};}),/transaction unavailable/);assert.equal(callback,false);
});
test('quota failure is explicit, shared across request adapters, and never retries database writes',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return Response.json({error:{status:'RESOURCE_EXHAUSTED'}},{status:429});};const a=new Firestore('quota-test',async()=>'fake',fetcher),b=new Firestore('quota-test',async()=>'fake',fetcher);
 await assert.rejects(a.get('players/p'),e=>e.status===429&&e.code==='RESOURCE_EXHAUSTED'&&e.retryAfter===300);
 await assert.rejects(b.get('players/p'),e=>e.status===429&&e.retryAfter>0);assert.equal(calls,1);
});
test('membership summaries skip unchanged readiness but retain removal and session-status transitions',()=>{
 const db=new Firestore('demo',async()=>'fake'),store=new GameStore(db,()=>{});let r=R.create({id:'membership_check',code:'ABCDEFGH',uid:'owner',playerId:'p',name:'Owner',mode:4},1);
 r=R.command(r,'guest',{type:'join',playerId:'pg',name:'Guest'},2,n=>n-1);r=R.command(r,'guest',{type:'claimSeat',seat:2},3,n=>n-1);
 const ready=R.command(r,'guest',{type:'ready'},4,n=>n-1),writes=store.projection(r,ready),path=db.name('onlineMemberships/guest/rooms/'+r.id);assert(!writes.some(w=>w.update?.name===path));assert(writes.some(w=>w.update?.name===db.name('onlineRooms/'+r.id)),'public readiness remains live');
 const removed=R.command(r,'owner',{type:'remove',target:'guest'},5,n=>n-1);assert.equal(store.projection(r,removed).find(w=>w.update?.name===path).update.fields.status.stringValue,'Removed');
 const stopped=R.command(r,'owner',{type:'stop'},6,n=>n-1);assert.equal(store.projection(r,stopped).find(w=>w.update?.name===path).update.fields.status.stringValue,'stopped');
});
