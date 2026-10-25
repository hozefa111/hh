import {test} from 'node:test';
import A from 'node:assert/strict';
import {Firestore} from '../firestore.mjs';
import {exportResult} from '../live-export.mjs';
const host=process.env.FIRESTORE_EMULATOR_HOST;
test('Firestore export commits once across lost responses, concurrency and tombstone races',{skip:!host,timeout:60000},async()=>{
 A.match(host,/^(localhost|127\.0\.0\.1):\d+$/);const prefix='export_'+crypto.randomUUID().replaceAll('-',''),paths=new Set();let lose=false;
 const db=new Firestore('demo-three-patti',async()=>'owner',async(url,init)=>{const b=init.body?JSON.parse(init.body):{};for(const w of b.writes||[])if(w.update)paths.add(w.update.name.split('/documents/')[1]);const res=await fetch(url,init);if(lose&&url.endsWith(':commit')&&res.ok){lose=false;throw Error('Lost successful response');}return res;},{origin:'http://'+host});
 const payload=id=>({roomId:id,key:'hand:'+id+'_1',revision:50,round:{timestamp:new Date(1000).toISOString(),source:'online',sessionId:id,playerIds:['p'],scoreChanges:{p:360}},hand:{handId:id+'_1',handNumber:1,scoreChanges:{p:360}},session:{source:'online',roomId:id,sessionName:'Export',startTime:new Date(1000).toISOString(),endTime:null,totalRounds:1}});
 try{
  const p=payload(prefix);lose=true;await A.rejects(exportResult(db,p),/Lost successful response/);await exportResult(db,p);const results=await Promise.all([exportResult(db,p),exportResult(db,p)]);A(results.every(r=>r.ok));A.deepEqual((await db.get('rounds/online_'+p.hand.handId)).scoreChanges,{p:360});
  const voided=payload(prefix+'_void');voided.round=null;voided.key='void:'+voided.hand.handId;voided.hand={...voided.hand,void:true,scoreChanges:{}};await exportResult(db,voided);await exportResult(db,voided);A.equal(await db.get('rounds/online_'+voided.hand.handId),null);A((await db.get('onlineRooms/'+voided.roomId+'/hands/'+voided.hand.handId)).void);
  const blocked=payload(prefix+'_blocked');await db.request(':commit','POST',{writes:[db.set('onlineTombstones/'+blocked.roomId,{deleted:true})]});A((await exportResult(db,blocked)).deleted);A.equal(await db.get('rounds/online_'+blocked.hand.handId),null);
  // A concurrent deletion transaction conflicts with any exporter that read the old tombstone state.
  const racing=payload(prefix+'_race'),remove=()=>db.transaction(async tx=>{await db.get('onlineTombstones/'+racing.roomId,tx);return {writes:[db.set('onlineTombstones/'+racing.roomId,{deleted:true}),db.delete('rounds/online_'+racing.hand.handId),db.delete('sessions/'+racing.roomId)],result:null};});
  await Promise.all([exportResult(db,racing),remove()]);await exportResult(db,racing);A.equal(await db.get('rounds/online_'+racing.hand.handId),null);A.equal(await db.get('sessions/'+racing.roomId),null);
 }finally{for(const p of paths)await db.request('/'+p,'DELETE');}
});
