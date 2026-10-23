// Reproducible matched-deal evaluation. Not a production load test or proof of
// optimal play: fixed old-policy contracts isolate card-play strategy changes.
const R=require('../shared/engine'),New=require('../shared/bot'),Old=require('./fixtures/bot-v2710.cjs');
const fs=require('node:fs'),A=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const seeds=Number(process.env.KALI_BOT_SIM_SEEDS||128),startSeed=Number(process.env.KALI_BOT_SIM_START||1);A(Number.isInteger(seeds)&&seeds>0&&seeds<=2000);A(Number.isInteger(startSeed)&&startSeed>0&&startSeed<1000000);
function random(seed){let x=seed>>>0;return n=>{x=(Math.imul(x,1664525)+1013904223)>>>0;return Math.floor(x/4294967296*n);};}
let now=1000,illegal=0;const latencies={old:[],new:[]};
function act(r,policy){const uid=r.hand.turn,cards=R.privateState(r,uid).cards,pub=R.publicState(r),t=performance.now(),action=policy.decide(pub,uid,cards);latencies[policy===Old?'old':'new'].push(performance.now()-t);
 if(action.type==='play'&&!R.legal(cards,r.hand.trick).includes(action.card))illegal++;
 return R.command(r,uid,{...action,automatic:true},now++,n=>n-1);
}
function deal(mode,seed){let r=R.create({id:'sim',code:'SIMULATE',uid:'a',name:'A',playerId:'pa',mode},now++);
 for(let seat=2;seat<=mode;seat++)r=R.command(r,'a',{type:'bot',seat,botId:'bot_'+seat},now++,n=>n-1);
 r=R.command(r,'a',{type:'ready'},now++,random(seed));while(r.hand.phase!=='playing')r=act(r,Old);return r;
}
function finish(initial,select){let r=initial,moves=0;while(R.active(r)){A(++moves<=modeCards(r.mode));r=act(r,select(r.hand.turn));}
 A.equal(Object.values(r.hand.captured).reduce((a,b)=>a+b,0),250);
 const expected=R.score(r.hand.seatMap.map(p=>p.uid),r.hand.bid,r.hand.bidder,r.hand.partners,r.hand.result);
 for(const p of r.hand.seatMap)A.equal(r.hand.scoreChanges[p.playerId],expected[p.uid]);return r;
}
const modeCards=mode=>mode===4?40:42,results=[];
for(const mode of [4,6]){
 const variants={baseline:{wins:0,points:0},newBiddingTeam:{wins:0,points:0},newOpposition:{wins:0,points:0},allNew:{wins:0,points:0}};
 for(let seed=startSeed;seed<startSeed+seeds;seed++){
  const initial=deal(mode,seed*7919+mode),team=new Set([initial.hand.bidder,...initial.hand.partners]);
  for(const [name,select] of Object.entries({baseline:()=>Old,newBiddingTeam:id=>team.has(id)?New:Old,newOpposition:id=>team.has(id)?Old:New,allNew:()=>New})){
   // The harness knows teams to select policies; policy itself ONLY receives
   // publicState + own cards through act(). No canonical state reaches a bot.
   const r=finish(initial,select);variants[name].wins+=r.hand.result==='win'?1:0;variants[name].points+=r.hand.teamPoints;
  }
 }
 results.push({mode,seeds,variants:Object.fromEntries(Object.entries(variants).map(([name,v])=>[name,{bidderTeamWinRate:v.wins/seeds,oppositionWinRate:1-v.wins/seeds,meanBidderTeamPoints:v.points/seeds}]))});
}
const summary={seedCountPerMode:seeds,startSeed,hands:seeds*2*4,contractSetup:'Identical seeded deals, bidder, bid, trump and called/direct partners selected by frozen old policy for every matched set. Only card play varies.',illegalMoves:illegal,results,decisions:Object.fromEntries(Object.entries(latencies).map(([k,values])=>{values.sort((a,b)=>a-b);return[k,{count:values.length,medianMs:values[Math.floor(values.length/2)],p95Ms:values[Math.floor(values.length*.95)],p99Ms:values[Math.floor(values.length*.99)],maxMs:values.at(-1)}];})),node:process.version,limitations:'Synthetic local Node CPU and fixed-contract self-play, not physical-phone/WAN timings or a statistically conclusive human skill rating.'};
A.equal(illegal,0);const dest=process.env.KALI_BOT_SIM_REPORT||'test-results/bot-comparison.json';fs.mkdirSync(require('node:path').dirname(dest),{recursive:true});fs.writeFileSync(dest,JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
