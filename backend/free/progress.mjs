// Explicit allowlist for operator-only, temporary progress diagnostics. Never
// serialize the canonical room, cards, player identities or hidden teams.
export function progress(room,now,{alarmAt,exporting,pending}){
 const h=room?.hand,p=h&&room.members[h.turn];
 return {serverNow:now,revision:room?.revision,status:room?.status,mode:room?.mode,paused:!!room?.paused,phase:h?.phase||null,turnSeat:p?.seat||null,turnKind:p?.kind||null,generation:h?.turnGeneration??null,deadlineInMs:h?.deadline==null?null:h.deadline-now,tricksCompleted:h?.tricks.length||0,playedCount:h?.trick.length||0,alarmInMs:alarmAt==null?null:alarmAt-now,exportInFlight:!!exporting,pendingExport:!!pending};
}
export function diagnosticEnabled(setting,room,now){const [code,until]=String(setting||'').split('@');return !!room&&code===room.code&&Number.isSafeInteger(Number(until))&&Number(until)>now&&Number(until)<=now+3600000;}
