const {test}=require('node:test');const A=require('node:assert/strict'),R=require('../shared/engine');const {GameService}=require('../../functions/online/service');
class Store{
 constructor(){this.rooms=new Map;this.receipts=new Map;this.rounds=new Map;this.chain=Promise.resolve();}
 async profile(id){return {name:id};}async lookup(code){return [...this.rooms.values()].find(r=>r.code===code)?.id;}
 async create(r){this.rooms.set(r.id,r);}
 async transact(id,key,fingerprint,fn){const job=this.chain.then(()=>{if(key&&this.receipts.has(key)){const old=this.receipts.get(key);if(old.fingerprint!==fingerprint)throw Error('Command ID already used');return old.result;}
 const before=this.rooms.get(id),{next,result}=fn(before);if(next){if(next.completed>before.completed){const round=R.roundRecord(next);A(!this.rounds.has(round.handId));this.rounds.set(round.handId,round);}this.rooms.set(id,next);}if(key)this.receipts.set(key,{fingerprint,result});return result;});this.chain=job.catch(()=>{});return job;}
}
async function fixture(mode=4){let seq=0,now=1000;const store=new Store,service=new GameService(store,{random:n=>n-1,id:()=>String(++seq),code:()=> 'ABCDEFGH',clock:()=>now});const who={uid:'admin',admin:true};const {roomId}=await service.create(who,{playerId:'pa',mode});
 const send=async(uid,action,extra={})=>service.execute({uid,admin:uid==='admin'},{roomId,revision:store.rooms.get(roomId).revision,commandId:'command_'+(++seq),action,...extra});return{store,service,who,roomId,send,time:v=>now=v};}
test('service rejects nonadmin creation and missing profiles',async()=>{const f=await fixture();await A.rejects(f.service.create({uid:'x',admin:false},{playerId:'px',mode:4}));});
test('seat actions reject inherited object keys without mutating shared prototypes',async()=>{const f=await fixture();const before=Object.getOwnPropertyDescriptors(Object.prototype);for(const key of ['__proto__','constructor','toString']){await A.rejects(f.send('admin',{type:'remove',target:key}),/Not a room participant/);await A.rejects(f.send('admin',{type:'swap',target:'admin',other:key}),/Not a room participant/);}A.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype),before);A.equal(f.store.rooms.get(f.roomId).revision,0);});
test('atomic seat race: only one claims empty seat',async()=>{const f=await fixture();for(const u of ['u','v']){await f.send(u,{type:'join',playerId:'p'+u});await f.send('admin',{type:'approve',target:u,playerId:'p'+u});}const revision=f.store.rooms.get(f.roomId).revision;const results=await Promise.allSettled(['u','v'].map(u=>f.send('admin',{type:'seat',target:u,seat:2},{revision})));A.equal(results.filter(r=>r.status==='fulfilled').length,1);A.equal(R.ordered(f.store.rooms.get(f.roomId)).length,2);});
test('idempotency, altered payload and stale revision rejection',async()=>{const f=await fixture(),request={roomId:f.roomId,revision:0,commandId:'unique_123',action:{type:'bot',seat:2}};const a=await f.service.execute(f.who,request),b=await f.service.execute(f.who,request);A.deepEqual(a,b);A.equal(f.store.rooms.get(f.roomId).revision,1);await A.rejects(f.service.execute(f.who,{...request,action:{type:'bot',seat:3}}));await A.rejects(f.send('admin',{type:'bot',seat:3},{revision:0}));});
test('client cannot forge automatic action or server presence',async()=>{const f=await fixture();await A.rejects(f.send('admin',{type:'presence',connected:false}));for(let seat=2;seat<=4;seat++)await f.send('admin',{type:'bot',seat});await f.send('admin',{type:'ready'});const r=f.store.rooms.get(f.roomId),turn=r.hand.turn;f.time(r.hand.deadline+1);await A.rejects(f.send(turn,{type:'bid',bid:160,automatic:true}),/deadline/);});
test('two concurrent timeout tasks apply only once; late action rejected',async()=>{const f=await fixture();for(let seat=2;seat<=4;seat++)await f.send('admin',{type:'bot',seat});await f.send('admin',{type:'ready'});const r=f.store.rooms.get(f.roomId),h=r.hand;f.time(h.deadline);const results=await Promise.all([f.service.due(f.roomId,h.id,h.turnGeneration),f.service.due(f.roomId,h.id,h.turnGeneration)]);A.equal(results.filter(r=>r.ignored).length,1);A.equal(f.store.rooms.get(f.roomId).revision,r.revision+1);await A.rejects(f.send(h.turn,{type:'bid',bid:165},{revision:r.revision}));});
test('paused timeout is ignored, exact reconnect and deadline preserved',async()=>{const f=await fixture();for(let seat=2;seat<=4;seat++)await f.send('admin',{type:'bot',seat});await f.send('admin',{type:'ready'});const h=f.store.rooms.get(f.roomId).hand;await f.service.presence(f.roomId,'admin',false);f.time(h.deadline+1000);A((await f.service.due(f.roomId,h.id,h.turnGeneration)).ignored);await f.service.presence(f.roomId,'admin',true);await f.send('admin',{type:'resume'});A.deepEqual(f.store.rooms.get(f.roomId).hand.hands,h.hands);});
test('many authoritative scheduled actions complete exactly one unified round',async()=>{const f=await fixture(6);for(let seat=2;seat<=6;seat++)await f.send('admin',{type:'bot',seat});await f.send('admin',{type:'ready'});let steps=0;while(R.active(f.store.rooms.get(f.roomId))){A(++steps<150);const r=f.store.rooms.get(f.roomId),h=r.hand;
 if(h.deadline!==null){f.time(h.deadline);await f.service.due(f.roomId,h.id,h.turnGeneration);}else{const B=require('../shared/bot'),action=B.decide(R.publicState(r),h.turn,R.privateState(r,h.turn).cards);await f.send(h.turn,action);}}
 A.equal(f.store.rounds.size,1);const r=f.store.rooms.get(f.roomId),rec=[...f.store.rounds.values()][0];A.deepEqual(rec.playerIds,['pa']);A.equal(Object.values(r.hand.captured).reduce((a,b)=>a+b),250);A.equal(rec.sessionId,f.roomId);
});
test('waiting-list metadata cannot invalidate an otherwise current hand action',async()=>{const f=await fixture();for(let seat=2;seat<=4;seat++)await f.send('admin',{type:'bot',seat});await f.send('admin',{type:'ready'});const before=f.store.rooms.get(f.roomId),h=before.hand;await f.send('waiting',{type:'join',playerId:'waiting'});await f.service.execute({uid:h.turn},{roomId:f.roomId,revision:before.revision,handId:h.id,turnGeneration:h.turnGeneration,commandId:'valid_turn_123',action:{type:'bid',pass:true}});A.equal(f.store.rooms.get(f.roomId).hand.passed[0],h.turn);await A.rejects(f.service.execute({uid:h.turn},{roomId:f.roomId,revision:before.revision,handId:h.id,turnGeneration:h.turnGeneration,commandId:'stale_turn_123',action:{type:'bid',bid:160}}));});

test('join requires existing profile; server resolves name and blocks duplicate requests without changing reconnect identity',async()=>{
 const f=await fixture();const original=f.store.profile;f.store.profile=async id=>id==='missing'?null:original(id);
 await A.rejects(f.send('u',{type:'join',name:'Invented'}),/existing Players/);
 await A.rejects(f.send('u',{type:'join',playerId:'missing'}),/not found/);
 await f.send('u',{type:'join',playerId:'pu',name:'Forged'});
 let p=f.store.rooms.get(f.roomId).members.u;A.equal(p.name,'pu');A.equal(p.playerId,'pu');A.equal(p.requestedPlayerId,'pu');A.equal(p.approved,true);A.equal(p.status,'Waiting');
 await A.rejects(f.send('v',{type:'join',playerId:'pu'}),/already participating/);
 await f.send('admin',{type:'approve',target:'u',playerId:'pu'});await f.send('admin',{type:'seat',target:'u',seat:2});
 await f.send('u',{type:'join',playerId:'pu'});A.equal(f.store.rooms.get(f.roomId).members.u.seat,2);
 await A.rejects(f.send('u',{type:'join',playerId:'other'}),/existing player profile/);
});
test('custom session name persists and history actions require admin and valid input',async()=>{
 const f=await fixture();const created=await f.service.create(f.who,{playerId:'pa',mode:4,sessionName:'  Friday at home  '});A.equal(f.store.rooms.get(created.roomId).sessionName,'Friday at home');
 await A.rejects(f.service.create(f.who,{playerId:'pa',mode:4,sessionName:' '}),/Session name/);
 await A.rejects(f.service.history({uid:'guest'},{sessionId:f.roomId,action:'delete',commandId:'history_123'}),/Admin access/);
 await A.rejects(f.service.history(f.who,{sessionId:'../bad',action:'delete',commandId:'history_123'}),/Invalid session/);
 await A.rejects(f.service.history(f.who,{sessionId:f.roomId,action:'rename',name:' ',commandId:'history_123'}),/Session name/);
});

test('self-joined identity cannot silently switch its profile',async()=>{
 const f=await fixture();await f.send('u',{type:'join',playerId:'chosen'});
 await A.rejects(f.send('u',{type:'join',playerId:'different'}),/existing player profile/);
 A.equal(f.store.rooms.get(f.roomId).members.u.playerId,'chosen');
});

test('human auction deadline is exactly 30 seconds and expires to one permanent automatic PASS',async()=>{const f=await fixture();for(let seat=2;seat<=4;seat++){const uid='human_'+seat;await f.send(uid,{type:'join',playerId:'profile_'+seat});await f.send('admin',{type:'approve',target:uid,playerId:'profile_'+seat});await f.send('admin',{type:'seat',target:uid,seat});}for(let seat=2;seat<=4;seat++)await f.send('human_'+seat,{type:'ready'});await f.send('admin',{type:'ready'});const before=f.store.rooms.get(f.roomId),h=before.hand;A.equal(h.turn,'human_2');A.equal(h.deadline,31000);f.time(h.deadline-1);A((await f.service.due(f.roomId,h.id,h.turnGeneration)).ignored);f.time(h.deadline);await f.service.due(f.roomId,h.id,h.turnGeneration);const next=f.store.rooms.get(f.roomId);A.equal(next.hand.turn,'human_3');A.deepEqual(next.hand.passed,['human_2']);A.equal(next.hand.auction.at(-1).pass,true);A.equal(next.hand.auction.at(-1).reason,'timeout');A.equal(next.hand.auction.at(-1).automatic,true);A((await f.service.due(f.roomId,h.id,h.turnGeneration)).ignored);await A.rejects(f.send('human_2',{type:'bid',bid:160}));});

test('presence acknowledgement repairs a stale Disconnected label even when connected flag is true',async()=>{const f=await fixture();const r=f.store.rooms.get(f.roomId);r.members.admin.status='Disconnected';A.equal(r.members.admin.connected,true);await f.service.presence(f.roomId,'admin',true);const p=f.store.rooms.get(f.roomId).members.admin;A.equal(p.connected,true);A.equal(p.status,'Seated');});

test('concurrent fresh bid submissions accept one; equal/lower bids cannot change the auction or scores',async()=>{for(const mode of [4,6]){const f=await fixture(mode);for(let seat=2;seat<=mode;seat++)await f.send('admin',{type:'bot',seat});await f.send('admin',{type:'ready'});const r=f.store.rooms.get(f.roomId),h=r.hand;const responses=await Promise.allSettled(['bid_race_first','bid_race_second'].map(commandId=>f.service.execute({uid:h.turn},{roomId:f.roomId,revision:r.revision,handId:h.id,turnGeneration:h.turnGeneration,commandId,action:{type:'bid',bid:180}})));A.equal(responses.filter(r=>r.status==='fulfilled').length,1);const after=f.store.rooms.get(f.roomId);A.equal(after.hand.bid,180);A.equal(after.hand.auction.filter(a=>a.bid===180).length,1);for(const bid of [155,175,180,182,255]){await A.rejects(f.send(after.hand.turn,{type:'bid',bid}));A.deepEqual(f.store.rooms.get(f.roomId),after);}A.deepEqual(after.totals,r.totals);A.equal(f.store.rounds.size,0);}});

test('bot replacement has a server-owned identity and concurrent replacements commit once',async()=>{const f=await fixture();await f.send('u',{type:'join',playerId:'pu'});await f.send('admin',{type:'approve',target:'u',playerId:'pu'});await f.send('admin',{type:'seat',target:'u',seat:2});const revision=f.store.rooms.get(f.roomId).revision;const results=await Promise.allSettled(['replace_first','replace_second'].map(commandId=>f.service.execute(f.who,{roomId:f.roomId,revision,commandId,action:{type:'replaceBot',target:'u',botId:'forged'}})));A.equal(results.filter(r=>r.status==='fulfilled').length,1);const r=f.store.rooms.get(f.roomId),bot=R.ordered(r).find(p=>p.seat===2);A.equal(bot.kind,'bot');A.notEqual(bot.uid,'forged');A.equal(r.totals.pu,0);A.equal(r.totals[bot.uid],0);A.equal(f.store.rounds.size,0);});

for(const mode of [4,6])test(`${mode} seats: players join and claim their own seat without approval`,async()=>{
 const f=await fixture(mode);
 for(let seat=2;seat<=mode;seat++){const u='human_'+seat;await f.send(u,{type:'join',playerId:'p'+u});await f.send(u,{type:'claimSeat',seat});}
 for(let seat=2;seat<=mode;seat++)await f.send('human_'+seat,{type:'ready'});
 let r=f.store.rooms.get(f.roomId);A.equal(R.ordered(r).length,mode);A(R.allReadyExceptAdmin(r));
 await A.rejects(f.send('human_2',{type:'stop'}),/admin/);
 await A.rejects(f.send('human_2',{type:'claimSeat',seat:2,target:'admin'}),/own seat/);
 await f.send('admin',{type:'ready'});r=f.store.rooms.get(f.roomId);const hands=JSON.stringify(r.hand.hands);
 await f.send('waiting',{type:'join',playerId:'pwaiting'});await A.rejects(f.send('waiting',{type:'claimSeat',seat:2}),/locked/);
 await f.send('human_2',{type:'join',playerId:'phuman_2'});r=f.store.rooms.get(f.roomId);A.equal(r.members.human_2.seat,2);A.equal(r.members.waiting.seat,null);A.deepEqual(R.privateState(r,'waiting').cards,[]);A.equal(JSON.stringify(r.hand.hands),hands);
});
test('two humans racing for one seat have exactly one winner without admin approval',async()=>{
 const f=await fixture();for(const u of ['u','v'])await f.send(u,{type:'join',playerId:'p'+u});const revision=f.store.rooms.get(f.roomId).revision;
 const outcomes=await Promise.allSettled(['u','v'].map(u=>f.send(u,{type:'claimSeat',seat:2},{revision})));
 A.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);const r=f.store.rooms.get(f.roomId);A.equal(R.ordered(r).filter(p=>p.seat===2).length,1);
 const loser=outcomes[0].status==='rejected'?'u':'v';await A.rejects(f.send(loser,{type:'claimSeat',seat:2}),/occupied/);
});
test('self-seating preserves scores, resets readiness and releases the old seat',async()=>{
 const f=await fixture();await f.send('u',{type:'join',playerId:'pu'});await f.send('u',{type:'claimSeat',seat:2});await f.send('u',{type:'ready'});await f.send('u',{type:'claimSeat',seat:3});let r=f.store.rooms.get(f.roomId);A.equal(r.members.u.ready,false);A.equal(r.members.u.seat,3);A.equal(r.totals.pu,0);
 await f.send('u',{type:'leave'});await f.send('v',{type:'join',playerId:'pv'});await f.send('v',{type:'claimSeat',seat:3});r=f.store.rooms.get(f.roomId);A.equal(r.members.u.seat,null);A.equal(r.members.v.seat,3);A.equal(r.totals.pu,0);A.equal(r.totals.pv,0);
 for(const seat of [0,5,2.5,'2'])await A.rejects(f.send('v',{type:'claimSeat',seat}),/Invalid seat/);
});

test('legacy invited member can confirm their saved profile without admin action',async()=>{
 const f=await fixture();const r=f.store.rooms.get(f.roomId);r.members.old={uid:'old',name:'Saved',requestedPlayerId:'saved',playerId:null,kind:'human',seat:null,approved:false,ready:false,connected:true,status:'Invited'};
 await f.send('old',{type:'join',playerId:'saved'});await f.send('old',{type:'claimSeat',seat:2});A.equal(f.store.rooms.get(f.roomId).members.old.playerId,'saved');A.equal(f.store.rooms.get(f.roomId).members.old.seat,2);
});
test('final bid receipt retries and timeout races finalize only once',async()=>{for(const mode of [4,6]){const f=await fixture(mode);for(let seat=2;seat<=mode;seat++)await f.send('admin',{type:'bot',seat});await f.send('admin',{type:'ready'});while(!f.store.rooms.get(f.roomId).hand.finalBid){const r=f.store.rooms.get(f.roomId);await f.send(r.hand.turn,{type:'bid',pass:true});}const before=f.store.rooms.get(f.roomId),h=before.hand,req={roomId:f.roomId,revision:before.revision,handId:h.id,turnGeneration:h.turnGeneration,commandId:'final_keep_123',action:{type:'bid',keep:true}};const [a,b]=await Promise.all([f.service.execute(f.who,req),f.service.execute(f.who,req)]);A.deepEqual(a,b);A.equal(f.store.rooms.get(f.roomId).revision,before.revision+1);f.time(h.deadline);A((await f.service.due(f.roomId,h.id,h.turnGeneration)).ignored);A.equal(f.store.rooms.get(f.roomId).hand.phase,'trump');A.equal(f.store.rounds.size,0);
const t=await fixture(mode);for(let seat=2;seat<=mode;seat++)await t.send('admin',{type:'bot',seat});await t.send('admin',{type:'ready'});while(!t.store.rooms.get(t.roomId).hand.finalBid){const r=t.store.rooms.get(t.roomId);await t.send(r.hand.turn,{type:'bid',pass:true});}const last=t.store.rooms.get(t.roomId).hand;t.time(last.deadline);const results=await Promise.all([t.service.due(t.roomId,last.id,last.turnGeneration),t.service.due(t.roomId,last.id,last.turnGeneration)]);A.equal(results.filter(v=>v.ignored).length,1);A.equal(t.store.rooms.get(t.roomId).hand.bid,155);A.equal(t.store.rooms.get(t.roomId).hand.phase,'trump');await A.rejects(t.service.execute(t.who,{roomId:t.roomId,revision:t.store.rooms.get(t.roomId).revision,handId:last.id,turnGeneration:last.turnGeneration,commandId:'late_final_123',action:{type:'bid',bid:200}}));}});
