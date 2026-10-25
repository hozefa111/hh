// The immutable receipt, round and existing session summary commit together.
// Lifetime scores continue to be derived from rounds, never credited a second way.
export async function exportResult(db,payload){
 const {roomId,key,round,hand,session,revision}=payload,receipt='onlineExportReceipts/'+roomId+'_'+key.replace(/[^a-zA-Z0-9_-]/g,'_');
 return db.transaction(async tx=>{
  const [tombstone,done,current,existing]=await Promise.all([db.get('onlineTombstones/'+roomId,tx),db.get(receipt,tx),db.get('sessions/'+roomId,tx),round?db.get('rounds/online_'+hand.handId,tx):null]);
  if(tombstone)return {writes:[],result:{deleted:true}};
  const fingerprint=JSON.stringify(payload);if(done){if(done.fingerprint!==fingerprint)throw Error('Export receipt mismatch');return {writes:[],result:{ok:true}};}
  if(existing)throw Error('Round exists without matching export receipt');
  const writes=[];
  if(round)writes.push(db.set('rounds/online_'+hand.handId,{...round,timestamp:new Date(round.timestamp)},true));
  if(hand)writes.push(db.set('onlineRooms/'+roomId+'/hands/'+hand.handId,hand,true));
  if(!current||Number(current.exportRevision||0)<=revision)writes.push(db.set('sessions/'+roomId,{...session,startTime:new Date(session.startTime),endTime:session.endTime?new Date(session.endTime):null,exportRevision:revision}));
  writes.push(db.set(receipt,{fingerprint,revision,createdAt:new Date()},true));return {writes,result:{ok:true}};
 });
}
