import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Firestore} from '../firestore.mjs';
import {GameStore} from '../store.mjs';
import S from '../../../functions/online/service.js';
import R from '../../../functions/online/shared/engine.js';
import B from '../../../functions/online/shared/bot.js';
test('real Firestore REST transactions save a complete hand, restore receipts and preserve unified timestamps', {skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
 const project='demo-three-patti',origin='http://'+process.env.FIRESTORE_EMULATOR_HOST,created=new Set,rooms=new Map;
 assert.match(process.env.FIRESTORE_EMULATOR_HOST,/^(127\.0\.0\.1|localhost):\d+$/);
 const trackedFetch=async(url,init)=>{
  if(init.method==='POST'&&url.endsWith(':commit'))for(const w of JSON.parse(init.body).writes)if(w.update)created.add(w.update.name.split('/documents/')[1]);
  if(process.env.KALI_REST_TRACE)console.log(init.method,new URL(url).pathname);
  const res=await fetch(url,init);if(process.env.KALI_REST_TRACE)console.log('status',res.status);return res;
 };
 const db=new Firestore(project,async()=>'owner',trackedFetch,{origin}),profile='free_rest_'+crypto.randomUUID().replaceAll('-','');
 try{
  await db.request(':commit','POST',{writes:[db.set('players/'+profile,{name:'Free adapter test'},true)]});
  const store=new GameStore(db,async(id,r)=>{if(r)rooms.set(id,r);});let now=1000000;
  const service=new S.GameService(store,{id:()=>crypto.randomUUID().replaceAll('-',''),code:()=>crypto.randomUUID().toUpperCase().replace(/[^A-F]/g,'').padEnd(8,'A').slice(0,8),random:n=>Math.floor(Math.random()*n),clock:()=>now});
  const who={uid:'test_'+profile,admin:true},{roomId}=await service.create(who,{playerId:profile,mode:6});
  const send=(uid,action)=>service.execute({uid,admin:uid===who.uid},{roomId,revision:rooms.get(roomId).revision,commandId:crypto.randomUUID(),action});
  const command={roomId,revision:0,commandId:crypto.randomUUID(),action:{type:'bot',seat:2}};
  const first=await service.execute(who,command);assert.deepEqual(await service.execute(who,command),first);
  for(let seat=3;seat<=6;seat++)await send(who.uid,{type:'bot',seat});await send(who.uid,{type:'ready'});
  let steps=0;while(R.active(rooms.get(roomId))){assert(++steps<160);const r=rooms.get(roomId),h=r.hand;
   if(h.deadline!==null){now=h.deadline;await service.due(roomId,h.id,h.turnGeneration);}else await send(h.turn,B.decide(R.publicState(r),h.turn,R.privateState(r,h.turn).cards));
  }
  const r=rooms.get(roomId),round=await db.get('rounds/online_'+r.hand.id),session=await db.get('sessions/'+roomId);
  assert(round.timestamp instanceof Date);assert.equal(round.teamPoints,r.lastResult.teamPoints);assert.equal(session.totalRounds,1);assert(session.startTime instanceof Date);
  assert.equal(Object.values(round.captured).reduce((a,b)=>a+b),250);assert.deepEqual(round.playerIds,[profile]);
  await service.due(roomId,r.hand.id,r.hand.turnGeneration);assert.equal((await db.get('sessions/'+roomId)).totalRounds,1);
 }finally{for(const path of created)await db.request('/'+path,'DELETE');}
});
