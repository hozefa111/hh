'use strict';
// One authoritative deletion workflow for legacy manual and online session records.
const validDate=v=>v?.toDate?v.toDate():v;
function contains(round,session){if(round.sessionId)return round.sessionId===session.id;if(round.source==='online'||session.source==='online')return false;const time=+new Date(validDate(round.timestamp)),start=+new Date(validDate(session.startTime)),end=+new Date(validDate(session.endTime));return Number.isFinite(time)&&time>=start&&time<=end;}
function stable(v){if(v?.toDate)return v.toDate().toISOString();if(v instanceof Date)return v.toISOString();if(Array.isArray(v))return v.map(stable);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));return v;}
async function digest(v){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(stable(v))));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
class SessionDeletion{
 constructor(db,track=async()=>{}){this.db=db;this.track=track;}
 async all(collection,tx){const docs=[];let cursor=null;for(;;){const page=await this.db.scan(collection,cursor,100,tx);docs.push(...page);if(page.length<100)break;cursor=page.at(-1).id;}return docs;}
 async describe(id,expectedName,tx){
  const session=await this.db.get('sessions/'+id,tx),room=await this.db.get('onlineState/'+id,tx);
  if(!session)throw Error('Session not found');if(room?.historyDeleted)throw Error('Session was already deleted');
  if(!session.endTime||room&&room.status!=='stopped')throw Error('Stop the session before deleting its rounds and points');
  if(expectedName!==null&&expectedName!==session.sessionName)throw Error('Session name changed. Refresh and retry.');
  const snapshot={...session,id},all=await this.all('rounds',tx),rounds=all.filter(d=>contains(d.data,snapshot));
  if(session.source!=='online'){
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
   const page=await db.scan('rounds',job.cursor,100,tx);
   for(const d of page)if(contains(d.data,job.snapshot)){writes.push(db.set('sessionDeletionArchives/'+id+'_'+job.generation+'/rounds/'+d.id,d.data),db.delete('rounds/'+d.id));next.deletedRounds++;}
   next.cursor=page.at(-1)?.id||job.cursor;if(page.length<100){next.phase='hands';next.cursor=null;}
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
