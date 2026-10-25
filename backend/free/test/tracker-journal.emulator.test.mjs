import {test} from 'node:test';import A from 'node:assert/strict';import {Firestore} from '../firestore.mjs';
const host=process.env.FIRESTORE_EMULATOR_HOST;
test('public writes and immutable journal share atomic revision, including lost response and delete',{skip:!host,timeout:60000},async()=>{
 A.match(host,/^(localhost|127\.0\.0\.1):\d+$/);const db=new Firestore('demo-three-patti',async()=>'owner',undefined,{origin:'http://'+host}),id='journal_'+crypto.randomUUID().replaceAll('-','');
 const before=await db.get('trackerSync/state');await db.request(':commit','POST',{writes:[db.set('rounds/'+id,{scoreChanges:{p:360}},true)]});
 const head=await db.get('trackerSync/state');A.equal(head.revision,(before?.revision||0)+1);A.deepEqual((await db.get('trackerChanges/'+head.eventId)).paths,['rounds/'+id]);
 await A.rejects(db.request(':commit','POST',{writes:[db.set('rounds/'+id,{scoreChanges:{p:999}},true)]}));A.equal((await db.get('trackerSync/state')).revision,head.revision);
 await db.request(':commit','POST',{writes:[db.delete('rounds/'+id)]});const end=await db.get('trackerSync/state');A.equal(end.revision,head.revision+1);A.equal(await db.get('rounds/'+id),null);A.deepEqual((await db.get('trackerChanges/'+end.eventId)).paths,['rounds/'+id]);
 // Non-tracker state and private hands do not generate any tracker journal entries.
 await db.request(':commit','POST',{writes:[db.set('onlineRooms/'+id+'/private/u',{cards:['AS']})]});A.equal((await db.get('trackerSync/state')).revision,end.revision);await db.request('/onlineRooms/'+id+'/private/u','DELETE');
});
