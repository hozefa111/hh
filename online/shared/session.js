(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.PattiSession=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 function includes(round,session){if(round.sessionId)return round.sessionId===session.id;if(round.source==='online'||session.source==='online')return false;const t=+new Date(round.timestamp),start=+new Date(session.startTime),end=session.endTime?+new Date(session.endTime):Infinity;return t>=start&&t<=end;}
 function groupRounds(rounds,sessions){
  const bounds=sessions.filter(s=>s.source!=='online'&&!String(s.id).startsWith('cf2_')).map(s=>({id:s.id,start:+new Date(s.startTime),end:s.endTime?+new Date(s.endTime):Infinity})),groups=new Map(),seen=new Map();let anonymous=0;
  for(const round of rounds){
   if(round.type==='settlement'||round.source==='online'||round.type==='practice'||round.mode==='practice'||round.source==='practice'||round.isPractice===true||round.practice===true)continue;
   let target=round.sessionId;
   if(!target){const t=+new Date(round.timestamp),eligible=bounds.filter(s=>t>=s.start&&t<s.end);if(eligible.length!==1)continue;target=eligible[0].id;}
   const key=round.id||'anonymous_'+anonymous++;if(!seen.has(target)){seen.set(target,new Set());groups.set(target,[]);}if(!seen.get(target).has(key)){seen.get(target).add(key);groups.get(target).push(round);}
  }
  for(const rows of groups.values())rows.sort((a,b)=>+new Date(b.timestamp)-+new Date(a.timestamp));return groups;
 }
 function roundsFor(rounds,sessions,target){return groupRounds(rounds,sessions).get(target)||[];}
 return {includes,roundsFor,groupRounds};

});
