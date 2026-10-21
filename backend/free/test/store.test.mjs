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
  if(suffix===':batchGet'){const name=body.documents[0],fields=this.docs.get(name.split('/documents/')[1]);return Response.json([fields?{found:{name,fields}}:{missing:name}]);}
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
  await f.send(h.turn,h.phase==='auction'?{type:'bid',pass:true}:B.decide(R.publicState(r),h.turn,R.privateState(r,h.turn).cards));
 }
 const pub=f.memory.get('onlineRooms/'+f.roomId);assert.equal(pub.hand.secret,null);assert.equal(pub.hand.partners,null);assert(!('hands'in pub.hand));
 const own=f.memory.get('onlineRooms/'+f.roomId+'/private/admin');assert.equal(own.cards.length,7);
 f.memory.put('players/pwaiting',{name:'Waiting'});await f.send('waiting',{type:'join',playerId:'pwaiting'});const waiting=f.memory.get('onlineRooms/'+f.roomId+'/private/waiting');assert.deepEqual(waiting.cards,[]);
});
test('REST profile linking cannot steal a previously linked human identity',async()=>{
 const f=await fixture(4);f.memory.put('players/pb',{name:'B'});f.memory.put('onlineProfileLinks/pb',{uid:'someone-else',playerId:'pb'});
 await f.send('b',{type:'join',playerId:'pb'});await assert.rejects(f.send('admin',{type:'approve',target:'b',playerId:'pb'}),/another identity/);
 assert.equal(f.rooms.get(f.roomId).members.b.approved,false);
});

test('online rename stays synchronized; stopped-session deletion preserves scored rounds and is exactly once',async()=>{
 const f=await fixture(4);const meta=(action,name,extra={})=>f.service.history(f.who,{sessionId:f.roomId,action,name,commandId:'history_'+crypto.randomUUID(),...extra});
 await meta('rename','Friday game');assert.equal(f.memory.get('onlineRooms/'+f.roomId).sessionName,'Friday game');assert.equal(f.memory.get('onlineMemberships/admin/rooms/'+f.roomId).sessionName,'Friday game');
 await assert.rejects(meta('delete'),/Stop the online session/);
 for(let seat=2;seat<=4;seat++)await f.send('admin',{type:'bot',seat});await f.send('admin',{type:'ready'});
 let steps=0;while(R.active(f.rooms.get(f.roomId))){assert(++steps<160);const r=f.rooms.get(f.roomId),h=r.hand;if(h.deadline!==null){f.time(h.deadline);await f.service.due(r.id,h.id,h.turnGeneration);}else await f.send(h.turn,B.decide(R.publicState(r),h.turn,R.privateState(r,h.turn).cards));}
 assert.equal(f.memory.get('sessions/'+f.roomId).sessionName,'Friday game');
 await assert.rejects(meta('rename','Other',{expectedName:'Stale name'}),/changed/);
 await f.send('admin',{type:'stop'});const roundPath='rounds/online_'+f.rooms.get(f.roomId).hand.id,round=f.memory.get(roundPath),totals=f.rooms.get(f.roomId).totals;
 const commandId='history_delete_123';await meta('delete',undefined,{commandId,expectedName:'Friday game'});await meta('delete',undefined,{commandId,expectedName:'Friday game'});
 assert.equal(f.memory.get('sessions/'+f.roomId),null);assert.equal(f.memory.get('onlineMemberships/admin/rooms/'+f.roomId),null);assert.deepEqual(f.memory.get(roundPath),round);assert.deepEqual(f.rooms.get(f.roomId).totals,totals);assert(f.rooms.get(f.roomId).historyDeleted);
 await assert.rejects(meta('rename','Resurrect'),/already deleted/);
 const before=f.rooms.get(f.roomId);for(const w of f.store.projection(before,before))assert(!w.update?.name.includes('/sessions/'));
 await assert.rejects(meta('rename','Changed',{commandId}),/already used/);
});
test('legacy online session metadata can be renamed/deleted without modifying manual records or lifetime rounds',async()=>{
 const f=await fixture(4);f.memory.put('sessions/legacy',{source:'online',sessionName:'Old online',endTime:new Date(1000),leaderboard:[{name:'A',score:360}]});f.memory.put('sessions/manual',{sessionName:'Manual',endTime:new Date(1000)});
 await f.service.history(f.who,{sessionId:'legacy',action:'rename',name:'Renamed',commandId:'rename_legacy_123',expectedName:'Old online'});assert.equal(f.memory.get('sessions/legacy').sessionName,'Renamed');
 await f.service.history(f.who,{sessionId:'legacy',action:'delete',commandId:'delete_legacy_123'});assert.equal(f.memory.get('sessions/legacy'),null);assert.equal(f.memory.get('sessions/manual').sessionName,'Manual');
 await assert.rejects(f.service.history(f.who,{sessionId:'manual',action:'delete',commandId:'delete_manual_123'}),/Online session not found/);
});
