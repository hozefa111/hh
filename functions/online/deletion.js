'use strict';
// One authoritative deletion workflow for legacy manual and online session records.
const validDate=v=>v?.toDate?v.toDate():v;
function contains(round,session){if(round.sessionId)return round.sessionId===session.id;if(round.source==='online'||session.source==='online')return false;const time=+new Date(validDate(round.timestamp)),start=+new Date(validDate(session.startTime)),end=+new Date(validDate(session.endTime));return Number.isFinite(time)&&time>=start&&time<=end;}
function stable(v){if(v?.toDate)return v.toDate().toISOString();if(v instanceof Date)return v.toISOString();if(Array.isArray(v))return v.map(stable);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));return v;}
async function digest(v){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(stable(v))));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
class SessionDeletion{
 constructor(db,track=async()=>{}){this.db=db;this.track=track;}
 async all(collection,tx){const docs=[];let cursor=null;for(;;){const page=await this.db.scan(collection,cursor,100,tx);docs.push(...page);if(page.length<100)break;cursor=page.at(-1).id;}return docs;}
 async selected(session,tx){
  const docs=new Map(),equality={fieldFilter:{field:{fieldPath:'sessionId'},op:'EQUAL',value:{stringValue:session.id}}};
  let cursor=null;for(;;){const page=await this.db.scan('rounds',cursor,100,tx,{where:equality});for(const d of page)docs.set(d.id,d);if(page.length<100)break;cursor=page.at(-1).id;}
  if(session.source!=='online'){
   const start=+new Date(validDate(session.startTime)),end=+new Date(validDate(session.endTime));
   if(Number.isFinite(start)&&Number.isFinite(end)){
    const where={compositeFilter:{op:'AND',filters:[{fieldFilter:{field:{fieldPath:'timestamp'},op:'GREATER_THAN_OR_EQUAL',value:{timestampValue:new Date(start).toISOString()}}},{fieldFilter:{field:{fieldPath:'timestamp'},op:'LESS_THAN_OR_EQUAL',value:{timestampValue:new Date(end).toISOString()}}}]}};
    cursor=null;for(;;){const page=await this.db.scan('rounds',cursor,100,tx,{where,timestamp:true});for(const d of page)if(!d.data.sessionId&&contains(d.data,session))docs.set(d.id,d);if(page.length<100)break;const last=page.at(-1);cursor={id:last.id,time:+new Date(validDate(last.data.timestamp))};}
   }
  }return [...docs.values()].sort((a,b)=>a.id.localeCompare(b.id));
 }
 async describe(id,expectedName,tx,sessionOverride=null){
  const session=sessionOverride||await this.db.get('sessions/'+id,tx),room=await this.db.get('onlineState/'+id,tx);
  if(!session)throw Error('Session not found');if(room?.historyDeleted)throw Error('Session was already deleted');
  if(!session.endTime||room&&room.status!=='stopped')throw Error('Stop the session before deleting its rounds and points');
  if(expectedName!==null&&expectedName!==session.sessionName)throw Error('Session name changed. Refresh and retry.');
  const snapshot={...session,id},rounds=await this.selected(snapshot,tx);
  if(session.source!=='online'&&rounds.some(d=>!d.data.sessionId)){
   const others=(await this.all('sessions',tx)).filter(d=>d.id!==id&&d.data.source!=='online');
   if(rounds.some(d=>!d.data.sessionId&&others.some(s=>s.data.endTime&&contains(d.data,{...s.data,id:s.id}))))throw Error('Some older rounds match multiple sessions. Assign their session before deletion.');
  }
  const scoreChanges=Object.create(null),names=Object.create(null),bots=new Set;
  for(const p of session.leaderboard||[]){names[p.playerId||p.id]=p.name;}
  for(const {data:r}of rounds){for(const p of r.participants||[]){names[p.playerId]=p.name;if(p.kind==='bot')bots.add(p.playerId);}
   if(r.hukumId)names[r.hukumId]=r.hukumName;for(const [i,pid]of(r.partnerIds||[]).entries())names[pid]=r.partnerNames?.[i]||names[pid];for(const [i,pid]of(r.nonPartnerIds||[]).entries())names[pid]=r.nonPartnerNames?.[i]||names[pid];
   for(const [pid,n]of Object.entries(r.scoreChanges||{})){if(typeof n!=='number'||!Number.isSafeInteger(n))throw Error('Invalid saved score; deletion requires review');scoreChanges[pid]=(scoreChanges[pid]||0)+n;if(!Number.isSafeInteger(scoreChanges[pid]))throw Error('Saved score total is outside safe limits');}
  }
  const previewToken=await digest({session:snapshot,version:session._cascadeVersion||null,rounds});
  return {snapshot,preview:{roundCount:rounds.length,previewToken,impacts:Object.entries(scoreChanges).filter(([pid])=>!bots.has(pid)&&!pid.startsWith('bot_')).map(([playerId,points])=>({playerId,name:names[playerId]||playerId,lifetimeChange:-points})),sessionName:session.sessionName}};
 }
 async preview(id,expectedName){return this.db.transaction(async tx=>{
  const job=await this.db.get('sessionDeletions/'+id,tx);if(job&&job.status!=='complete')return {writes:[],result:{...job.preview,deleting:true}};
  const {preview}=await this.describe(id,expectedName,tx);return {writes:[],result:preview};
 });}
 async execute(uid,request){
  const id=request.sessionId;await this.track(id,true);
  try{
   await this.db.transaction(async tx=>{
    const path='sessionDeletions/'+id,job=await this.db.get(path,tx);
    const restored=job?.status==='complete'?await this.db.get('sessions/'+id,tx):null;
    if(job&&!restored){if(job.preview.previewToken!==request.previewToken)throw Error('Deletion confirmation changed. Refresh and retry.');return {writes:[],result:null};}
    const lock=await this.db.get('meta/sessionDeletionLock',tx);if(lock&&lock.sessionId!==id)throw Error('Another session deletion is finishing. Retry shortly.');
    const {snapshot,preview}=await this.describe(id,request.expectedName,tx);if(preview.previewToken!==request.previewToken)throw Error('Session rounds changed. Review the deletion again.');
    const writes=[this.db.set(path,{sessionId:id,generation:crypto.randomUUID(),actor:uid,status:'deleting',phase:'rounds',cursor:null,memberCursor:0,deletedRounds:0,snapshot,preview,startedAt:new Date()}),this.db.set('meta/sessionDeletionLock',{sessionId:id}),this.db.set('sessions/'+id,{...snapshot,status:'deleting'})];
    if(snapshot.source==='online')writes.push(this.db.set('onlineTombstones/'+id,{roomId:id,at:new Date()}));
    return {writes,result:null};
   });
   return await this.step(id);
  }catch(e){if(!await this.db.get('sessionDeletions/'+id))await this.track(id,false);throw e;}
 }
 async step(id){const db=this.db;const result=await db.transaction(async tx=>{
  const path='sessionDeletions/'+id,job=await db.get(path,tx);if(!job)return {writes:[],result:{pending:false}};
  if(job.status==='complete')return {writes:[],result:{ok:true,pending:false,deletedRounds:job.deletedRounds}};
  const next={...job},writes=[];
  if(job.phase==='rounds'){
   const session={...job.snapshot,id},modern=job.roundPhase!=='legacy';
   let options;if(modern)options={where:{fieldFilter:{field:{fieldPath:'sessionId'},op:'EQUAL',value:{stringValue:id}}}};
   else options={timestamp:true,where:{compositeFilter:{op:'AND',filters:[{fieldFilter:{field:{fieldPath:'timestamp'},op:'GREATER_THAN_OR_EQUAL',value:{timestampValue:new Date(validDate(session.startTime)).toISOString()}}},{fieldFilter:{field:{fieldPath:'timestamp'},op:'LESS_THAN_OR_EQUAL',value:{timestampValue:new Date(validDate(session.endTime)).toISOString()}}}]}}};
   const page=await db.scan('rounds',job.cursor,100,tx,options);
   for(const d of page)if(contains(d.data,session)&&(modern||!d.data.sessionId)){writes.push(db.set('sessionDeletionArchives/'+id+'_'+job.generation+'/rounds/'+d.id,d.data),db.delete('rounds/'+d.id));next.deletedRounds++;}
   const last=page.at(-1);next.cursor=last?(modern?last.id:{id:last.id,time:+new Date(validDate(last.data.timestamp))}):job.cursor;if(page.length<100){next.cursor=null;if(modern&&job.snapshot.source!=='online'&&Number.isFinite(+new Date(validDate(session.startTime)))&&Number.isFinite(+new Date(validDate(session.endTime))))next.roundPhase='legacy';else{
    // Skip legacy-only cleanup phases only after proving both are empty in this transaction.
    const [hands,room]=await Promise.all([db.scan('onlineRooms/'+id+'/hands',null,1,tx),db.get('onlineState/'+id,tx)]);
    next.phase=hands.length||Object.keys(room?.members||{}).length?'hands':'finish';
   }}
  }else if(job.phase==='hands'){
   const page=await db.scan('onlineRooms/'+id+'/hands',job.cursor,100,tx);
   for(const d of page)writes.push(db.set('sessionDeletionArchives/'+id+'_'+job.generation+'/hands/'+d.id,d.data),db.delete('onlineRooms/'+id+'/hands/'+d.id));
   next.cursor=page.at(-1)?.id||job.cursor;if(page.length<100){next.phase='members';next.cursor=null;}
  }else if(job.phase==='members'){
   const room=await db.get('onlineState/'+id,tx),ids=Object.keys(room?.members||{}),slice=ids.slice(job.memberCursor,job.memberCursor+100);
   for(const uid of slice)writes.push(db.delete('onlineMemberships/'+uid+'/rooms/'+id),db.delete('onlineRooms/'+id+'/members/'+uid),db.delete('onlineRooms/'+id+'/private/'+uid));
   next.memberCursor+=slice.length;if(next.memberCursor>=ids.length)next.phase='finish';
  }else{
   const room=await db.get('onlineState/'+id,tx),lock=await db.get('meta/sessionDeletionLock',tx);
   if(room){writes.push(db.set('onlineState/'+id,{...room,revision:room.revision+1,historyDeleted:true}),db.delete('onlineCodes/'+room.code));}
   writes.push(db.delete('onlineRooms/'+id),db.delete('sessions/'+id));if(lock?.sessionId===id)writes.push(db.delete('meta/sessionDeletionLock'));
   next.status='complete';next.completedAt=new Date();
  }
  writes.push(db.set(path,next));return {writes,result:{ok:true,pending:next.status!=='complete',deletedRounds:next.deletedRounds,roundCount:next.preview.roundCount}};
 });await this.track(id,!!result.pending);return result;}
}
module.exports={SessionDeletion,contains,digest};
