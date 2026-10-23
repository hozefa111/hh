(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./engine'));else root.KaliBot=factory(root.KaliRules);})(typeof globalThis!=='undefined'?globalThis:this,function(R){
'use strict';
// Input contract: publicState + ONLY this participant's remaining cards. No IO,
// randomness, canonical deal, secret-holder lookup or persistent cross-room memory.
const low=(a,b)=>R.points(a)-R.points(b)||R.strength(a)-R.strength(b)||R.SUITS.indexOf(R.card(a).suit)-R.SUITS.indexOf(R.card(b).suit);
const sum=cards=>cards.reduce((n,c)=>n+R.points(c),0);
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function observation(room,uid,cards){
 const h=room.hand,ids=h.seatMap.map(p=>p.uid),played=new Set(),voids=Object.fromEntries(ids.map(id=>[id,new Set()]));
 for(const trick of [...h.tricks,{cards:h.trick}]){
  if(!trick.cards.length)continue;const lead=R.card(trick.cards[0].card).suit;
  for(const p of trick.cards){played.add(p.card);if(R.card(p.card).suit!==lead)voids[p.uid].add(lead);}
 }
 const known=new Set([h.bidder,h.direct,...(h.revealed?(h.partners||[]):[]),...(cards.includes(h.called)?[uid]:[])].filter(Boolean));
 // A holder knows its own membership before reveal. Nobody else is told it.
 const resolved=!!h.revealed||cards.includes(h.called),onBidTeam=known.has(uid);
 const candidates=ids.filter(id=>id!==h.bidder&&id!==uid);
 const bidProbability=id=>known.has(id)?1:id===uid||resolved?0:1/Math.max(1,candidates.length);
 const teammate=id=>id===uid?1:onBidTeam?bidProbability(id):1-bidProbability(id);
 const unknown=R.deck(room.mode,h.config).filter(c=>!played.has(c)&&!cards.includes(c));
 const start=ids.indexOf(uid),later=Array.from({length:room.mode-h.trick.length-1},(_,i)=>ids[(start+i+1)%ids.length]);
 const captured=h.captured||{},taken=Object.values(captured).reduce((a,b)=>a+b,0),remaining=Math.max(0,250-taken);
 const teamCaptured=ids.reduce((n,id)=>n+(captured[id]||0)*(onBidTeam?bidProbability(id):1-bidProbability(id)),0);
 // Opponents need strictly more than 250-bid; no scoreboard formula is changed.
 const target=onBidTeam?h.bid:251-h.bid,need=Math.max(0,(target||155)-teamCaptured);
 const urgency=need===0?0.8:clamp(0.8+need/Math.max(1,remaining),0.8,1.8);
 return {h,uid,cards,ids,voids,unknown,later,teammate,urgency,remaining,need};
}
// Hypergeometric P(at least one success), sampling without replacement. Public
// voids and hand counts constrain the pool; no real unseen card is inspected.
function hasAny(pool,count,predicate){
 const n=pool.length,k=pool.filter(predicate).length,m=Math.min(n,Math.max(0,count));if(!k||!m)return 0;
 let none=1;for(let i=0;i<m;i++){if(n-k-i<=0)return 1;none*=(n-k-i)/(n-i);}return 1-none;
}
function threat(o,id,trick){
 const {h,voids}=o,lead=R.card(trick[0].card).suit,winner=R.trickWinner(trick,h.trump),winning=trick.find(p=>p.uid===winner).card;
 const pool=o.unknown.filter(c=>!voids[id].has(R.card(c).suit)&&(!h.revealed||!h.secret||id===h.secret||c!==h.called));
 const count=h.counts?.[id]??Math.max(1,Math.ceil(o.unknown.length/(o.ids.length-1)));
 const wins=c=>R.trickWinner([...trick,{uid:id,card:c}],h.trump)===id;
 const follow=hasAny(pool,count,c=>R.card(c).suit===lead&&wins(c));
 if(lead===h.trump)return follow;
 const noLead=1-hasAny(pool,count,c=>R.card(c).suit===lead);
 const off=pool.filter(c=>R.card(c).suit!==lead);
 // A ruff requires being void in the led suit, even when a high trump is held.
 const ruff=hasAny(off,count,c=>R.card(c).suit===h.trump&&wins(c));
 // The two cases are disjoint. A trump already winning cannot lose to led suit.
 return clamp((R.card(winning).suit===h.trump?0:follow)+noLead*ruff,0,1);
}
function controlCost(o,card){
 const suit=R.card(card).suit,higher=o.unknown.filter(c=>R.card(c).suit===suit&&R.strength(c)>R.strength(card)).length;
 const future=Math.max(0,o.cards.length-1)/Math.max(1,o.cards.length);
 const control=higher===0?6:higher===1?3:higher===2?1.2:0.2;
 // Small trumps also have future ruffing value. Preserve the last high trump in
 // quiet tricks, but a valuable capture or urgent contract can outweigh cost.
 return future*(control+(suit===o.h.trump?4+R.strength(card)*0.45:0));
}
function evaluate(o,card){
 const trick=[...o.h.trick,{uid:o.uid,card}],winner=R.trickWinner(trick,o.h.trump);
 let secure=o.teammate(winner);
 for(const id of o.later)secure*=1-(1-o.teammate(id))*threat(o,id,trick);
 const pot=sum(trick.map(p=>p.card));
 // Unplayed seats commonly contribute point cards. Do not value an empty lead
 // as an empty finished trick. A won trick also grants the next lead.
 const futurePoints=o.later.length*4;
 // Own points could still be captured later if saved; discount their immediate
 // donation value so an extra five points does not waste a master trump.
 const immediate=pot-R.points(card)*0.4+futurePoints;
 const score=(2*secure-1)*immediate*o.urgency+secure*4-controlCost(o,card);
 return {card,score,teamWinProbability:secure,points:pot,preservationCost:controlCost(o,card)};
}
function assess(room,uid,cards){const o=observation(room,uid,cards);return R.legal(cards,o.h.trick).map(c=>evaluate(o,c)).sort((a,b)=>b.score-a.score||low(a.card,b.card));}
function chooseCard(room,uid,cards){
 const legal=R.legal(cards,room.hand.trick);if(legal.length===1)return legal[0];
 if(!room.hand.trick.length){
  const o=observation(room,uid,cards),masters=legal.filter(c=>!o.unknown.some(x=>R.card(x).suit===R.card(c).suit&&R.strength(x)>R.strength(c)));
  const safe=masters.filter(c=>R.card(c).suit===o.h.trump||!o.ids.some(id=>id!==uid&&o.teammate(id)<1&&o.voids[id].has(R.card(c).suit)));
  if(safe.length)return safe.sort((a,b)=>R.points(b)-R.points(a)||low(a,b))[0];
  return legal.sort(low)[0];
 }
 return assess(room,uid,cards)[0].card;
}
function handStrength(room,cards){
 return R.SUITS.map(suit=>{
  const suited=cards.filter(c=>R.card(c).suit===suit),others=R.SUITS.filter(s=>s!==suit).map(s=>cards.filter(c=>R.card(c).suit===s));
  const sequence=R.RANKS.slice().reverse().filter(rank=>R.deck(room.mode,room.hand.config).includes(rank+suit));let top=0;
  for(const rank of sequence){if(!suited.includes(rank+suit))break;top++;}
  const trumpControls=suited.reduce((n,c)=>n+(R.card(c).rank==='A'?1:R.card(c).rank==='K'?0.7:R.card(c).rank==='Q'?0.45:0.12),0);
  const outsideControls=others.reduce((n,cs)=>n+(cs.some(c=>R.card(c).rank==='A')?0.9:0)+(cs.some(c=>R.card(c).rank==='K')&&cs.some(c=>R.card(c).rank==='A')?0.45:0),0);
  const ruffs=others.reduce((n,cs)=>n+(cs.length===0?0.65:cs.length===1?0.25:0),0)*Math.min(1,suited.length/3);
  const tricks=trumpControls+outsideControls+ruffs+Math.max(0,suited.length-(room.mode===4?3:2))*0.35+top*0.25;
  const value=tricks*22+suited.length*2+sum(suited)*0.12;
  // Partners contribute, but their cards are unknown; discount that expectation
  // and do not assume the six-player called partner is a distinct third player.
  const support=room.mode===4?70:85,limit=clamp(5*Math.floor((support+value-10)/5),155,230);
  return {suit,value,limit};
 }).sort((a,b)=>b.value-a.value||R.SUITS.indexOf(a.suit)-R.SUITS.indexOf(b.suit));
}
function decide(room,uid,cards,difficulty='normal'){
 const h=room.hand;if(h.phase==='auction'){
  let limit=handStrength(room,cards)[0].limit;
  if(difficulty==='easy'){
   const best=Math.max(...R.SUITS.map(s=>{const cs=cards.filter(c=>R.card(c).suit===s);return cs.length*5+cs.filter(c=>['A','K','Q'].includes(R.card(c).rank)).length*7;}));
   limit=Math.min(170,155+5*Math.max(0,Math.floor((best-30)/5)));
  }
  return h.bid<limit?{type:'bid',bid:h.bid+5}:{type:'bid',pass:true};
 }
 if(h.phase==='trump')return {type:'trump',suit:handStrength(room,cards)[0].suit};
 if(h.phase==='partners'){
  const eligible=R.deck(room.mode,h.config).filter(c=>!cards.includes(c));
  // Prefer a missing top trump/control to connect to a useful hand, not the
  // 30-point low-strength 3 merely because its point value is highest.
  eligible.sort((a,b)=>{
   const value=c=>(R.card(c).suit===h.trump?8:0)+R.strength(c)*2+R.points(c)*0.12;
   return value(b)-value(a)||a.localeCompare(b);
  });
  const seats=h.seatMap,idx=seats.findIndex(p=>p.uid===uid),direct=seats[(idx+Math.floor(seats.length/2))%seats.length].uid;
  return {type:'partners',called:eligible[0],...(room.mode===6?{direct}:{})};
 }
 if(h.phase==='playing')return {type:'play',card:difficulty==='easy'?R.legal(cards,h.trick).sort(low)[0]:chooseCard(room,uid,cards)};
 throw new Error('No bot action available');
}
function timeout(room,uid,cards){return room.hand.phase==='auction'?{type:'bid',pass:true}:{type:'play',card:chooseCard(room,uid,cards)};}
return {decide,timeout,chooseCard,assess,handStrength};
});
