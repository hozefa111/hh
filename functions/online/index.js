const {journalTransaction,createTrackerPlayer}=require('./tracker-journal');
'use strict';
const {onRequest}=require('firebase-functions/v2/https');
const {onTaskDispatched}=require('firebase-functions/v2/tasks');
const {onValueWritten}=require('firebase-functions/v2/database');
const {onDocumentWritten}=require('firebase-functions/v2/firestore');
const {initializeApp,getApp}=require('firebase-admin/app');const {getAuth}=require('firebase-admin/auth');
const {getFirestore,FieldValue,Timestamp}=require('firebase-admin/firestore');const {getDatabase}=require('firebase-admin/database');const {getFunctions}=require('firebase-admin/functions');
const crypto=require('node:crypto');const R=require('./shared/engine');const {GameService}=require('./service');const {sessionRecord,historyChange}=require('./metadata');
initializeApp();const db=getFirestore(),region='asia-south1';
const id=()=>crypto.randomUUID().replaceAll('-',''),random=n=>crypto.randomInt(n),code=()=>Array.from({length:8},()=> 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[random(32)]).join('');
const canonical=id=>db.doc('onlineState/'+id),publicRef=id=>db.doc('onlineRooms/'+id);
async function bindProfile(tx,room,p){if(p.kind!=='human'||!p.approved||!p.playerId||p.reservation||p.status==='Removed')return;const duplicate=Object.values(room.members).some(other=>other.uid!==p.uid&&other.kind==='human'&&other.approved&&!other.reservation&&other.status!=='Removed'&&other.playerId===p.playerId);if(duplicate)throw new Error('Profile already participating in this room');return null;}


function writeRoom(tx,before,next,links=[]){
 tx.set(canonical(next.id),next);tx.set(publicRef(next.id),{...R.publicState(next),serverNow:Date.now()});
 for(const p of Object.values(next.members)){
  const prior=before?.members[p.uid],readable=p.kind==='human'&&!p.reservation&&p.status!=='Removed',wasReadable=prior&&prior.kind==='human'&&!prior.reservation&&prior.status!=='Removed';
  const access=publicRef(next.id).collection('members').doc(p.uid),privateRef=publicRef(next.id).collection('private').doc(p.uid);
  if(!readable){if(wasReadable){tx.delete(access);tx.delete(privateRef);}}
  else {
   if(!wasReadable||prior.playerId!==p.playerId||prior.status!==p.status)tx.set(access,{uid:p.uid,playerId:p.playerId,status:p.status});
   const own=R.privateState(next,p.uid),old=before?R.privateState(before,p.uid):null;
   if(!wasReadable||!old||old.handId!==own.handId||JSON.stringify(old.cards)!==JSON.stringify(own.cards))tx.set(privateRef,own);
  }
  // Room-list metadata has no reason to change on every card play.
  if(p.kind==='human'&&!p.reservation&&next.historyDeleted)tx.delete(db.doc('onlineMemberships/'+p.uid).collection('rooms').doc(next.id));
  else if(p.kind==='human'&&!p.reservation&&(!prior||prior.status!==p.status||before.status!==next.status||before.sessionName!==next.sessionName))tx.set(db.doc('onlineMemberships/'+p.uid).collection('rooms').doc(next.id),{roomId:next.id,code:next.code,status:p.status==='Removed'?'Removed':next.status,createdAt:next.createdAt,sessionName:next.sessionName||'Online · '+next.code});
 }
 for(const l of links.filter(Boolean))tx.set(l.ref,l.data);
 const sessionChanged=!before||before.sessionName!==next.sessionName||before.startedAt!==next.startedAt||before.endedAt!==next.endedAt||before.completed!==next.completed||before.status!==next.status||JSON.stringify(before.totals)!==JSON.stringify(next.totals);
 if(next.historyDeleted)tx.delete(db.doc('sessions/'+next.id));
 else if((next.startedAt||next.status==='stopped')&&sessionChanged)tx.set(db.doc('sessions/'+next.id),sessionRecord(next));
 if(next.hand&&(!before?.hand||before.hand.id!==next.hand.id||before.hand.phase!==next.hand.phase)&&['complete','void'].includes(next.hand.phase)){
  const h=next.hand;tx.set(publicRef(next.id).collection('hands').doc(h.id),{...(h.phase==='complete'?next.lastResult:{handId:h.id,void:true,seatMap:h.seatMap}),handNumber:h.number,completedAt:h.completedAt||Date.now(),tricks:h.tricks,deckConfig:h.config});
  if(h.phase==='complete')tx.create(db.doc('rounds/online_'+h.id),{...R.roundRecord(next),timestamp:Timestamp.fromMillis(h.completedAt)});
 }
}

const store={
 history:async(uid,request)=>journalTransaction(db,async tx=>{
  const receipt=db.doc('onlineHistoryReceipts/'+uid+'_'+request.commandId),saved=await tx.get(receipt),fingerprint=JSON.stringify(request);
  if(saved.exists){if(saved.data().fingerprint!==fingerprint)throw new Error('Command ID already used');return saved.data().result;}
  const state=await tx.get(canonical(request.sessionId)),ref=db.doc('sessions/'+request.sessionId),session=await tx.get(ref);
  const before=state.exists?state.data():null,{next,result}=historyChange(before,session.exists?session.data():null,request);
  if(next)writeRoom(tx,before,next);
  else if(request.action==='delete')tx.delete(ref);else tx.update(ref,{sessionName:request.name});
  tx.create(receipt,{fingerprint,result,createdAt:FieldValue.serverTimestamp()});return result;
 }),
 profile:async id=>{if(!id||!/^[-a-zA-Z0-9_]{1,128}$/.test(id))return null;const s=await db.doc('players/'+id).get();return s.exists?s.data():null;},
 lookup:async code=>{const s=await db.doc('onlineCodes/'+code).get();return s.exists?s.data().roomId:null;},
 create:async(room)=>journalTransaction(db,async tx=>{const codeRef=db.doc('onlineCodes/'+room.code),cs=await tx.get(codeRef);if(cs.exists)throw new Error('Room code collision. Please create again.');const link=await bindProfile(tx,room,room.members[room.admin]);tx.create(codeRef,{roomId:room.id});writeRoom(tx,null,room,[link]);}),
 transact:async(roomId,key,fingerprint,fn)=>journalTransaction(db,async tx=>{
  const state=await tx.get(canonical(roomId));if(!state.exists)throw new Error('Room not found');
  const receipt=key?canonical(roomId).collection('receipts').doc(key):null;if(receipt){const s=await tx.get(receipt);if(s.exists){if(s.data().fingerprint!==fingerprint)throw new Error('Command ID already used');return s.data().result;}}
  const before=state.data(),{next,result}=fn(before);if(!next)return result;
  const links=[];for(const p of Object.values(next.members))if(p.approved&&p.kind==='human'&&!p.reservation&&p.status!=='Removed'&&(!before.members[p.uid]?.approved||before.members[p.uid]?.playerId!==p.playerId))links.push(await bindProfile(tx,next,p));
  writeRoom(tx,before,next,links);if(receipt)tx.create(receipt,{fingerprint,result,createdAt:FieldValue.serverTimestamp()});return result;
 })
};
const deletionDb={
 get:async(path,tx)=>{const s=await(tx?tx.get(db.doc(path)):db.doc(path).get());if(!s.exists)return null;const data=s.data();Object.defineProperty(data,'_cascadeVersion',{value:s.updateTime?.toDate().toISOString()||null});return data;},
 scan:async(collection,after,limit,tx,options={})=>{let q=db.collection(collection);if(options.where){const filters=options.where.compositeFilter?.filters||[options.where];for(const f of filters){const v=f.fieldFilter;q=q.where(v.field.fieldPath,{EQUAL:'==',GREATER_THAN_OR_EQUAL:'>=',LESS_THAN_OR_EQUAL:'<='}[v.op],v.value.stringValue??new Date(v.value.timestampValue));}}if(options.timestamp)q=q.orderBy('timestamp');q=q.orderBy(require('firebase-admin/firestore').FieldPath.documentId()).limit(limit);if(after)q=options.timestamp?q.startAfter(new Date(after.time),after.id):q.startAfter(after);const s=await(tx?tx.get(q):q.get());return s.docs.map(d=>({id:d.id,data:d.data(),version:d.updateTime?.toDate().toISOString()||null}));},
 set:(path,value)=>({path,value}),delete:path=>({path,remove:true}),
 transaction:fn=>journalTransaction(db,async tx=>{const {writes,result}=await fn(tx);for(const w of writes){if(w.remove)tx.delete(db.doc(w.path));else tx.set(db.doc(w.path),w.value);}return result;})
};
store.deletion=new(require('./deletion').SessionDeletion)(deletionDb);
const service=new GameService(store,{random,id,code});
async function realtime(path,method='GET',value,instance=getApp().options.projectId+'-default-rtdb'){
 const emulator=process.env.FIREBASE_DATABASE_EMULATOR_HOST;
 const url=emulator?'http://'+emulator+path+'.json?ns='+encodeURIComponent(instance):'https://'+instance+'.firebaseio.com'+path+'.json';
 const token=emulator?'owner':(await getApp().options.credential.getAccessToken()).access_token;
 const response=await fetch(url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(value)}),signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw new Error('Presence sync unavailable ('+response.status+')');return response.json();
}
async function grantPresence(roomId,uid){
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(roomId||''))throw new Error('Invalid room');
 const access=publicRef(roomId).collection('members').doc(uid);if(!(await access.get()).exists)throw new Error('Room admission required');
 const path='/onlineAcl/'+roomId+'/'+encodeURIComponent(uid);await realtime(path,'PUT',true);
 if(!(await access.get()).exists){await realtime(path,'PUT',null);throw new Error('Room access was removed');}
}
async function applyDue(data){
 const snap=await canonical(data.roomId).get(),room=snap.data(),h=room?.hand;
 if(!h||h.id!==data.handId||h.turnGeneration!==data.generation||!R.active(room)||room.paused||h.deadline===null||Date.now()<h.deadline)return;
 if(room.members[h.turn].kind==='human'){
  const connections=await realtime('/onlinePresence/'+room.id+'/'+encodeURIComponent(h.turn)+'/connections');
  if(!connections||!Object.keys(connections).length){await service.presence(room.id,h.turn,false);return;}
 }
 return service.due(data.roomId,data.handId,data.generation);
}
async function identity(req){const token=/^Bearer (.+)$/.exec(req.headers.authorization||'');if(!token)throw new Error('Sign in required');const decoded=await getAuth().verifyIdToken(token[1],true);const adminDoc=await db.doc('admins/'+decoded.uid).get();return{uid:decoded.uid,admin:decoded.admin===true||adminDoc.exists};}
async function rate(uid){const ref=db.doc('onlineLimits/'+uid);await journalTransaction(db,async tx=>{const s=await tx.get(ref),now=Date.now(),v=s.data(),same=v&&now-v.at<60000,count=same?v.count+1:1;if(count>90)throw new Error('Too many requests; try again shortly');tx.set(ref,{at:same?v.at:now,count});});}
exports.kaliApi=onRequest({region,cors:['https://hozefa111.github.io','https://patti-pro-a61d8.web.app','https://patti-pro-a61d8.firebaseapp.com','https://appassets.androidplatform.net',/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/],maxInstances:20},async(req,res)=>{
 try{if(req.method!=='POST'){res.status(405).json({error:'POST required'});return;}const who=await identity(req);await rate(who.uid);const body=req.body||{};let result;
  if(body.operation==='create')result=await service.create(who,body);
  else if(body.operation==='sessionHistory')result=await service.history(who,body);
  else if(body.operation==='presenceSync'){
   if(!/^[a-zA-Z0-9_-]{1,100}$/.test(body.roomId||''))throw new Error('Invalid room');
   if(!(await publicRef(body.roomId).collection('members').doc(who.uid).get()).exists)throw new Error('Room admission required');
   const connections=await realtime('/onlinePresence/'+body.roomId+'/'+who.uid+'/connections'),connected=Object.keys(connections||{}).length>0;
   await service.presence(body.roomId,who.uid,connected);result={connected};
  }
  else if(body.operation==='presenceAccess'){await grantPresence(body.roomId,who.uid);result={ok:true};}
  else if(body.operation==='register'){
   if(!who.admin)throw new Error('Admin access required');const name=String(body.name||'').trim();if(!name||name.length>60)throw new Error('Invalid name');const ref=db.collection('players').doc();await createTrackerPlayer(db,ref,{name,active:true,createdAt:FieldValue.serverTimestamp()});result={playerId:ref.id};
  }else if(body.operation==='exchange'){
   // This endpoint is invoked by the native app, never through a Javascript interface.
   const secret=crypto.randomBytes(32).toString('hex'),hash=crypto.createHash('sha256').update(secret).digest('hex');await db.doc('onlineExchanges/'+hash).set({uid:who.uid,expiresAt:Date.now()+30000});result={exchange:secret};
  }else if(body.operation==='clock')result={serverNow:Date.now()};
  else result=await service.execute(who,body);res.json({...result,serverNow:Date.now()});
 }catch(e){res.status(400).json({error:e.message||'Action failed'});}
});
exports.kaliConsumeExchange=onRequest({region,cors:['https://appassets.androidplatform.net',/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/]},async(req,res)=>{
 try{if(req.method!=='POST')throw new Error('POST required');const value=req.body?.exchange;if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw new Error('Invalid exchange');const ref=db.doc('onlineExchanges/'+crypto.createHash('sha256').update(value).digest('hex'));const uid=await journalTransaction(db,async tx=>{const s=await tx.get(ref);if(!s.exists||s.data().expiresAt<Date.now())throw new Error('Exchange expired');tx.delete(ref);return s.data().uid;});res.json({token:await getAuth().createCustomToken(uid)});}catch(e){res.status(400).json({error:e.message});}
});
exports.kaliTurn=onTaskDispatched({region,retryConfig:{maxAttempts:5,minBackoffSeconds:1},rateLimits:{maxConcurrentDispatches:20}},async req=>{await applyDue(req.data);});
exports.kaliSchedule=onDocumentWritten({region,document:'onlineState/{roomId}'},async event=>{
 const r=event.data.after.data(),old=event.data.before.data(),h=r?.hand;if(!h||r.paused||!R.active(r)||h.deadline===null||old?.hand?.id===h.id&&old?.hand?.turnGeneration===h.turnGeneration)return;
 if(process.env.FUNCTIONS_EMULATOR==='true')return;
 await getFunctions().taskQueue('locations/'+region+'/functions/kaliTurn').enqueue({roomId:r.id,handId:h.id,generation:h.turnGeneration},{scheduleTime:new Date(h.deadline)});
});
exports.kaliMembershipAccess=onDocumentWritten({region,document:'onlineRooms/{roomId}/members/{uid}',retry:true},async event=>{
 const {roomId,uid}=event.params,current=await publicRef(roomId).collection('members').doc(uid).get();
 await realtime('/onlineAcl/'+roomId+'/'+encodeURIComponent(uid),'PUT',current.exists?true:null);
 if(!current.exists)await realtime('/onlinePresence/'+roomId+'/'+encodeURIComponent(uid),'PUT',null);
});
exports.kaliPresence=onValueWritten({region:'us-central1',retry:true,ref:'/onlinePresence/{roomId}/{uid}/connections'},async event=>{
 const snap=await canonical(event.params.roomId).get(),room=snap.data(),person=room?.members?.[event.params.uid];
 if(!person||person.kind!=='human'||person.status==='Removed'||room.status==='stopped')return;
 const connections=await realtime('/onlinePresence/'+event.params.roomId+'/'+encodeURIComponent(event.params.uid)+'/connections','GET',undefined,event.instance);
 await service.presence(event.params.roomId,event.params.uid,!!connections&&Object.keys(connections).length>0);
});
// Emulator-only scheduler: task queues are not supplied by Firebase emulators.
if(process.env.FUNCTIONS_EMULATOR==='true')exports.kaliEmulatorTick=onRequest({region},async(req,res)=>{const rooms=await db.collection('onlineState').get();for(const s of rooms.docs){const r=s.data();if(r.hand)await applyDue({roomId:r.id,handId:r.hand.id,generation:r.hand.turnGeneration});}const jobs=await db.collection('sessionDeletions').where('status','==','deleting').get();for(const job of jobs.docs)await store.deletion.step(job.id);res.json({ok:true});});
