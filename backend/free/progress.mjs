// Explicit allowlist for operator-only, temporary progress diagnostics. Never
// serialize the canonical room, cards, player identities or hidden teams.
export function progress(room,now,{alarmAt,exporting,pending}){
 const h=room?.hand,p=h&&room.members[h.turn];
 return {serverNow:now,revision:room?.revision,status:room?.status,mode:room?.mode,paused:!!room?.paused,phase:h?.phase||null,handNumber:h?.number??null,turnSeat:p?.seat||null,turnKind:p?.kind||null,generation:h?.turnGeneration??null,deadlineInMs:h?.deadline==null?null:h.deadline-now,tricksCompleted:h?.tricks.length||0,playedCount:h?.trick.length||0,alarmInMs:alarmAt==null?null:alarmAt-now,exportInFlight:!!exporting,pendingExport:!!pending};
}
export function diagnosticEnabled(setting,room,now){const [code,until]=String(setting||'').split('@');return !!room&&code===room.code&&Number.isSafeInteger(Number(until))&&Number(until)>now&&Number(until)<=now+3600000;}
// Operator-only, expiring, single-room observation. No player identity is minted
// or impersonated; the output is the same card/identity-free progress allowlist.
export async function probeAllowed(request,setting,code,now){
 const [target,until,hash]=String(setting||'').split('@'),token=/^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('Authorization')||'')?.[1];
 if(!/^V2[A-Z0-9]{6}$/.test(code||'')||code!==target||!diagnosticEnabled(target+'@'+until,{code},now)||!token||!/^[a-f0-9]{64}$/.test(hash||''))return false;
 const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
 let mismatch=0;for(let i=0;i<64;i++)mismatch|=actual.charCodeAt(i)^hash.charCodeAt(i);return mismatch===0;
}
export async function readHealthProbe(request,env){
 const code=new URL(request.url).searchParams.get('code'),hidden=()=>new Response(null,{status:404,headers:{'Cache-Control':'no-store'}});
 if(request.method!=='GET'||!await probeAllowed(request,env.ROOM_HEALTH_PROBE,code,Date.now()))return hidden();
 const found=await env.KALI_LIVE_DIRECTORY.getByName('directory-v2').fetch(new Request('https://directory/',{method:'POST',body:JSON.stringify({op:'lookup',code})})),id=await found.json();
 if(!/^cf2_[a-f0-9]{32}$/.test(id||''))return hidden();
 return env.KALI_LIVE_ROOMS.getByName(id).fetch(new Request('https://room/',{method:'POST',headers:{Authorization:request.headers.get('Authorization')},body:JSON.stringify({body:{operation:'operatorHealth',code}})}));
}
