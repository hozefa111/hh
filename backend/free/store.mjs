import R from '../../functions/online/shared/engine.js';
import deletion from '../../functions/online/deletion.js';
import metadata from '../../functions/online/metadata.js';
export class GameStore {
 constructor(db,track,trackDeletion){this.db=db;this.track=track;this.deletion=new deletion.SessionDeletion(db,trackDeletion);}
 profile(id){return id&&/^[-a-zA-Z0-9_]{1,128}$/.test(id)?this.db.get('players/'+id):null;}
 async lookup(code){if(!/^[A-Z2-9]{8}$/.test(code))throw Error('Room not found');return (await this.db.get('onlineCodes/'+code))?.roomId;}
 async links(tx,before,next){
  const writes=[];for(const p of Object.values(next.members)){
   if(p.kind!=='human'||!p.approved||!p.playerId||p.reservation||p.status==='Removed')continue;
   if(before?.members[p.uid]?.approved&&before.members[p.uid].playerId===p.playerId)continue;
   const path='onlineProfileLinks/'+p.playerId,link=await this.db.get(path,tx);
   if(link&&link.uid!==p.uid)throw Error('This player profile belongs to another identity; account recovery is required');
   writes.push(this.db.set(path,{uid:p.uid,playerId:p.playerId}));
  }return writes;
 }
 projection(before,next){
  const db=this.db,root='onlineRooms/'+next.id,writes=[db.set('onlineState/'+next.id,next),db.set(root,{...R.publicState(next),serverNow:Date.now()})];
  for(const p of Object.values(next.members)){
   const prior=before?.members[p.uid],readable=p.kind==='human'&&!p.reservation&&p.status!=='Removed',was=prior&&prior.kind==='human'&&!prior.reservation&&prior.status!=='Removed';
   if(!readable){if(was)writes.push(db.delete(root+'/members/'+p.uid),db.delete(root+'/private/'+p.uid));}
   else{
    if(!was||prior.playerId!==p.playerId||prior.status!==p.status)writes.push(db.set(root+'/members/'+p.uid,{uid:p.uid,playerId:p.playerId,status:p.status}));
    const own=R.privateState(next,p.uid),old=before?R.privateState(before,p.uid):null;
    if(!was||!old||old.handId!==own.handId||JSON.stringify(old.cards)!==JSON.stringify(own.cards))writes.push(db.set(root+'/private/'+p.uid,own));
   }
   if(p.kind==='human'&&!p.reservation&&next.historyDeleted)writes.push(db.delete('onlineMemberships/'+p.uid+'/rooms/'+next.id));
   else if(p.kind==='human'&&!p.reservation&&(!prior||prior.status!==p.status||before.status!==next.status||before.sessionName!==next.sessionName))writes.push(db.set('onlineMemberships/'+p.uid+'/rooms/'+next.id,{roomId:next.id,code:next.code,status:p.status==='Removed'?'Removed':next.status,createdAt:next.createdAt,sessionName:next.sessionName||'Online · '+next.code}));
  }
  const changed=!before||before.sessionName!==next.sessionName||before.startedAt!==next.startedAt||before.endedAt!==next.endedAt||before.completed!==next.completed||before.status!==next.status||JSON.stringify(before.totals)!==JSON.stringify(next.totals);
  if(next.historyDeleted)writes.push(db.delete('sessions/'+next.id));
  else if((next.startedAt||next.status==='stopped')&&changed)writes.push(db.set('sessions/'+next.id,metadata.sessionRecord(next)));
  if(next.hand&&(!before?.hand||before.hand.id!==next.hand.id||before.hand.phase!==next.hand.phase)&&['complete','void'].includes(next.hand.phase)){
   const h=next.hand;writes.push(db.set(root+'/hands/'+h.id,{...(h.phase==='complete'?next.lastResult:{handId:h.id,void:true,seatMap:h.seatMap}),handNumber:h.number,completedAt:h.completedAt||Date.now(),tricks:h.tricks,deckConfig:h.config}));
   if(h.phase==='complete')writes.push(db.set('rounds/online_'+h.id,{...R.roundRecord(next),timestamp:new Date(h.completedAt)},true));
  }return writes;
 }
 async history(uid,request){
  let nextState;const result=await this.db.transaction(async tx=>{
   const path='onlineHistoryReceipts/'+uid+'_'+request.commandId,fingerprint=JSON.stringify(request),receipt=await this.db.get(path,tx);
   if(receipt){if(receipt.fingerprint!==fingerprint)throw Error('Command ID already used');return {writes:[],result:receipt.result};}
   const before=await this.db.get('onlineState/'+request.sessionId,tx),session=await this.db.get('sessions/'+request.sessionId,tx);
   const {next,result}=metadata.historyChange(before,session,request);nextState=next;
   const writes=next?this.projection(before,next):[request.action==='delete'?this.db.delete('sessions/'+request.sessionId):this.db.set('sessions/'+request.sessionId,{...session,sessionName:request.name})];
   writes.push(this.db.set(path,{fingerprint,result,createdAt:new Date()},true));return {writes,result};
  });if(nextState)await this.track(request.sessionId,nextState);return result;
 }
 async create(room){
  await this.track(room.id);await this.db.transaction(async tx=>{
   if(await this.db.get('onlineCodes/'+room.code,tx))throw Error('Room code collision. Please create again.');
   const links=await this.links(tx,null,room);return {writes:[this.db.set('onlineCodes/'+room.code,{roomId:room.id},true),...this.projection(null,room),...links],result:null};
  });await this.track(room.id,room);
 }
 async transact(id,key,fingerprint,fn){
  await this.track(id);let nextState;
  const result=await this.db.transaction(async tx=>{
   const path=key?'onlineState/'+id+'/receipts/'+key:null;
   const [before,receipt]=await this.db.getMany(['onlineState/'+id,...(path?[path]:[])],tx);if(!before)throw Error('Room not found');
   if(receipt){if(receipt.fingerprint!==fingerprint)throw Error('Command ID already used');nextState=before;return {writes:[],result:receipt.result};}
   const {next,result}=fn(before);nextState=next||before;if(!next)return {writes:[],result};
   const links=await this.links(tx,before,next),writes=[...this.projection(before,next),...links];
   if(path)writes.push(this.db.set(path,{fingerprint,result,createdAt:new Date()},true));return {writes,result};
  });await this.track(id,nextState);return result;
 }
}
