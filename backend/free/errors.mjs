export function failure(e,headers={}){
 const quota=e?.code==='RESOURCE_EXHAUSTED',expired=e?.name==='JWTExpired';
 const unavailable=!!(e?.status||e?.code?.startsWith('ERR_'));
 if(e?.retryAfter)headers['Retry-After']=String(e.retryAfter);
 return Response.json({error:quota||e?.status===429?e.message:unavailable||expired?'Server connection or sign-in unavailable; reconnect and retry':String(e?.message||'Action failed').slice(0,180),...(quota?{code:e.code}:{})},{status:quota||e?.status===429?429:expired?401:unavailable?503:400,headers});
}
