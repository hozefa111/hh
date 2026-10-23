const {test}=require('node:test'),A=require('node:assert/strict'),R=require('../shared/engine'),B=require('../shared/bot');
function table(trick=[],extra={},mode=4){return {mode,hand:{phase:'playing',trump:'S',bid:180,bidder:'a',direct:null,called:'KH',revealed:false,partners:null,seatMap:'abcdef'.slice(0,mode).split('').map(uid=>({uid})),tricks:[],trick,captured:{},...extra}};}
const play=(uid,card)=>({uid,card});
function played(...cards){return cards.map(card=>({cards:[play('a',card)],winner:'a',points:R.points(card)}));}
test('called King takes valuable last-seat trick without premature public reveal',()=>{
 for(const mode of [4,6]){
  const trick=(mode===4?[play('c','10H'),play('d','JH'),play('a','5H')]:[play('c','10H'),play('d','JH'),play('e','QH'),play('f','7H'),play('a','5H')]);
  const r=table(trick,{direct:mode===6?'c':null},mode),before=JSON.stringify(r);
  A.equal(B.chooseCard(r,'b',['KH','8H','AS']),'KH');A.equal(JSON.stringify(r),before);A.equal(r.hand.revealed,false);
 }
});
test('called King is preserved when bidder Ace has already secured the trick',()=>{
 const r=table([play('c','7H'),play('d','9H'),play('a','AH')]);
 A.equal(B.chooseCard(r,'b',['KH','JH']),'JH');
});
test('called King is never played illegally when another suit must be followed',()=>{
 const r=table([play('a','10C')]);A.equal(B.chooseCard(r,'b',['KH','5C','AS']),'5C');
});
test('called King is not donated to an unbeatable opposing Ace',()=>{
 const r=table([play('c','AH'),play('d','JH'),play('a','7H')]);A.equal(B.chooseCard(r,'b',['KH','8H']),'8H');
});
test('called holder feeds bidder using legitimately known secret partnership',()=>{
 const r=table([play('c','7H'),play('d','9H'),play('a','AH')]);A.equal(B.chooseCard(r,'b',['KH','5H']),'KH');
});
test('direct partner feeds secure bidder without spending an Ace from another suit',()=>{
 const r=table([play('c','7H'),play('d','9H'),play('e','8H'),play('f','QH'),play('a','AH')],{direct:'b'},6);
 A.equal(B.chooseCard(r,'b',['10C','AC','7S']),'10C');
});
test('same direct/called partner is handled once and retains its King behind bidder Ace',()=>{
 const r=table([play('c','7H'),play('d','9H'),play('e','8H'),play('f','QH'),play('a','AH')],{direct:'b'},6);
 A.equal(B.chooseCard(r,'b',['KH','JH']),'JH');
});
test('revealed four-player opponents cooperate',()=>{
 const r=table([play('c','7H'),play('d','AH'),play('a','8H')],{revealed:true,partners:['c'],called:'3H'});
 A.equal(B.chooseCard(r,'b',['KH','5H']),'KH');
});
test('revealed six-player teams respect both distinct partners',()=>{
 const r=table([play('c','7H'),play('d','9H'),play('e','8H'),play('f','QH'),play('a','AH')],{direct:'c',revealed:true,partners:['b','c']},6);
 A.equal(B.chooseCard(r,'b',['KH','5H']),'KH');
});
test('valuable opponent trick is captured by cheapest sufficient trump',()=>{
 const r=table([play('c','3S'),play('d','AS'),play('a','5S')],{trump:'H',revealed:true,partners:['a'],bidder:'c'});
 A.equal(B.chooseCard(r,'b',['5H','AH','7C']),'5H');
});
test('quiet trick does not consume the only master trump',()=>{
 const r=table([play('c','7C'),play('d','8C'),play('a','9C')],{trump:'H',revealed:true,partners:['d'],bidder:'c'});
 A.equal(B.chooseCard(r,'b',['AH','7D']),'7D');
});
test('contract urgency can justify an otherwise expensive trump capture',()=>{
 const r=table([play('c','7C'),play('d','8C'),play('a','9C')],{trump:'H',bid:250,captured:{a:50,b:0,c:100,d:0},revealed:true,partners:['b']});
 A.equal(B.chooseCard(r,'b',['AH','7D']),'AH');
});
test('public void inference reduces unsafe point donation into a known ruff threat',()=>{
 const r=table([play('a','AH')],{trump:'S',revealed:true,partners:['b'],tricks:[{cards:[play('a','QH'),play('c','7D')],winner:'a',points:10}]});
 const scores=B.assess(r,'b',['KH','8H']);A.equal(scores[0].card,'8H');
});
test('Queen is enough when Ace is exhausted and King is in own hand',()=>{
 const r=table([play('a','9H')],{bidder:'c',revealed:true,partners:['d'],tricks:played('AH')});
 A.equal(B.chooseCard(r,'b',['KH','QH','5H']),'QH');
});
test('bidding and trump evaluate top sequences, distribution and actual suit control',()=>{
 const r=table([],{phase:'auction',bid:155});const strong=['AS','KS','QS','JS','10S','9S','AH','AC','AD','5H'],weak=['7S','8S','9H','8H','7H','6C','7C','8D','7D','3H'];
 A(B.handStrength(r,strong)[0].limit>B.handStrength(r,weak)[0].limit);
 A.equal(B.decide({...r,hand:{...r.hand,phase:'trump'}},'b',strong).suit,'S');
 A.deepEqual(B.decide(r,'b',weak),{type:'bid',pass:true});
 A.equal(B.decide(r,'b',strong).bid,160);
 A.deepEqual(B.decide({...r,hand:{...r.hand,bid:250}},'b',strong),{type:'bid',pass:true});
});
test('partner selection prefers a missing top control rather than high-point low-rank three',()=>{
 const r=table([],{phase:'partners',trump:'H'});const own=['AH','QH','JS','7C'];
 A.equal(B.decide(r,'a',own).called,'KH');A(!own.includes(B.decide(r,'a',own).called));
});
test('policy never reads canonical private fields, even if supplied as throwing getters',()=>{
 const r=table([play('a','7H')]);for(const k of ['hands','deck','secret'])Object.defineProperty(r.hand,k,{get(){throw Error('Forbidden private read '+k);}});
 A(R.legal(['KH','8H'],r.hand.trick).includes(B.chooseCard(r,'b',['KH','8H'])));
});
test('Easy remains intentionally basic; Normal wins instead of low-card discard',()=>{
 const r=table([play('c','7H'),play('d','9H'),play('a','QH')],{revealed:true,bidder:'c',partners:['d']});
 A.equal(B.decide(r,'b',['AH','5H'],'easy').card,'5H');A.equal(B.decide(r,'b',['AH','5H'],'normal').card,'AH');
});
test('all candidate evaluations stay finite, legal, deterministic and fast',()=>{
 const {performance}=require('node:perf_hooks'),r=table([play('a','7H')],{counts:{a:9,b:10,c:10,d:10}}),own=['KH','8H','AH','3S','5C','7C','9D','10D','AS','QS'],before=JSON.stringify(r),start=performance.now();
 for(let i=0;i<100;i++){const first=B.chooseCard(r,'b',own);A.equal(B.chooseCard(r,'b',own),first);for(const candidate of B.assess(r,'b',own)){A(Number.isFinite(candidate.score));A(R.legal(own,r.hand.trick).includes(candidate.card));A(candidate.teamWinProbability>=0&&candidate.teamWinProbability<=1);}}
 A.equal(JSON.stringify(r),before);A(performance.now()-start<5000,'200 tiny synchronous decisions exceeded five seconds');
});
