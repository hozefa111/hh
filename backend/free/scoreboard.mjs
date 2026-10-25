import R from '../../functions/online/shared/engine.js';
// Standings only: no cards, auction, trick details or unrevealed teams.
export function scoreboard(room,pendingExports=0){
 const participants=Object.values(room.members),stats=room.stats||{};
 const leaderboard=R.standings(room,false).filter(p=>(stats[p.id]?.roundsPlayed||0)>0||participants.some(m=>m.playerId===p.id&&m.seat!==null&&m.status!=='Removed')).map(p=>({id:p.id,name:p.name,score:p.score,roundsPlayed:stats[p.id]?.roundsPlayed||0,kind:participants.find(m=>m.playerId===p.id)?.kind||(p.id.startsWith('bot_')?'bot':'human'),wins:stats[p.id]?.wins||0,losses:stats[p.id]?.losses||0,asHukum:stats[p.id]?.asHukum||0,asPartner:stats[p.id]?.asPartner||0,last:room.lastResult?.scoreChanges?.[p.id]??null}));
 return {id:room.id,roomId:room.id,transport:room.transport||'firestore',source:'online',sessionName:room.sessionName,revision:room.revision,status:room.status,paused:room.paused,startTime:room.startedAt||room.createdAt,endTime:room.endedAt||null,totalRounds:room.completed,leaderboard,pendingExports};
}
