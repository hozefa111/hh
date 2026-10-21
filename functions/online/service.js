'use strict';
const R=require('./shared/engine'),B=require('./shared/bot');
// Infrastructure-independent transaction service. The adapter must serialize each room.
class GameService{
 constructor(store,{random,id,code,clock=Date.now}){this.store=store;this.random=random;this.id=id;this.code=code;this.clock=clock;}
 async create(identity,payload){if(!identity.admin)throw new Error('Admin access required');const id=this.id(),code=this.code();const playerId=payload.playerId;const profile=await this.store.profile(playerId);if(!profile)throw new Error('Choose an existing player or register a profile');
 const r=R.create({id,code,uid:identity.uid,name:profile.name,playerId,mode:payload.mode,config:payload.config,difficulty:payload.difficulty},this.clock());await this.store.create(r,identity);return {roomId:id,code};}
 async execute(identity,request){
  const uid=identity.uid;let roomId=request.roomId;if(request.action?.type==='join'&&!roomId)roomId=await this.store.lookup(String(request.code||'').trim().toUpperCase());
  if(!roomId||!/^[a-zA-Z0-9_-]{1,100}$/.test(roomId))throw new Error('Room not found');
  if(!/^[a-zA-Z0-9_-]{8,100}$/.test(request.commandId||''))throw new Error('Command ID required');
  const input=JSON.parse(JSON.stringify(request.action||{}));delete input.automatic;delete input.reason;
  if(input.type==='presence')throw new Error('Presence is server managed');
  // Resolve names through trusted profiles; callers cannot impersonate a profile by name.
  if(['approve','reserve'].includes(input.type)){
   if(input.playerId){const profile=await this.store.profile(input.playerId);if(!profile)throw new Error('Player profile not found');input.name=profile.name;}
  }
  if(input.type==='bot')input.botId='bot_'+this.id();
  if(input.type==='reserve')input.reservationId='reserved_'+this.id();
  const key=uid+'_'+request.commandId, fingerprint=JSON.stringify({roomId,action:request.action,revision:request.revision,handId:request.handId,turnGeneration:request.turnGeneration});
  return this.store.transact(roomId,key,fingerprint,(room)=>{
   for(const field of ['target','other'])if(input[field]!==undefined&&!Object.prototype.hasOwnProperty.call(room.members,input[field]))throw new Error('Not a room participant');
   const joining=input.type==='join';const gameAction=['bid','trump','partners','play'].includes(input.type),sameTurn=gameAction&&room.hand?.id===request.handId&&room.hand?.turnGeneration===request.turnGeneration;
   if(!joining&&request.revision!==room.revision&&!sameTurn)throw new Error('State changed. Please retry with the latest table.');
   if(['approve','reserve'].includes(input.type)&&input.playerId){const current=Object.values(room.members).find(p=>p.playerId===input.playerId&&p.uid!==input.target&&p.kind==='human'&&!p.reservation&&p.status!=='Removed');if(current)throw new Error('Profile already participating');}
   const next=R.command(room,uid,input,this.clock(),this.random);return {next,result:{roomId,revision:next.revision,serverNow:this.clock()}};
  });
 }
 async due(roomId,handId,generation){return this.store.transact(roomId,null,null,room=>{
  const h=room.hand,now=this.clock();if(!h||h.id!==handId||h.turnGeneration!==generation||room.paused||!R.active(room)||h.deadline===null||now<h.deadline)return {next:null,result:{ignored:true}};
  const p=room.members[h.turn],pub=R.publicState(room),cards=R.privateState(room,h.turn).cards;
  const action=p.kind==='bot'?B.decide(pub,p.uid,cards,p.difficulty):B.timeout(pub,p.uid,cards);
  const next=R.command(room,p.uid,{...action,automatic:true,reason:p.kind==='bot'?'bot':'timeout'},now,this.random);return {next,result:{revision:next.revision}};
 });}
 async presence(roomId,uid,isConnected){return this.store.transact(roomId,null,null,room=>{
  const p=room.members[uid];if(!p||p.status==='Removed'||p.kind==='bot'||p.connected===isConnected||room.status==='stopped')return {next:null,result:{ignored:true}};
  const next=R.command(room,uid,{type:'presence',connected:isConnected},this.clock(),this.random);return{next,result:{revision:next.revision}};
 });}
}
module.exports={GameService};
