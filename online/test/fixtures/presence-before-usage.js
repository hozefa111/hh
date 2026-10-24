// Frozen pre-optimization presence helper (84d5d65); browser benchmark only.
async function attachBaselinePresence(id){
 const owner=uid(),ctx={active:true,transport:false,epoch:0,pending:false,ref:null,retry:null,failures:0,access:false,attempt:null};
 const valid=epoch=>ctx.active&&subscribedRoomId===id&&uid()===owner&&ctx.epoch===epoch;
 const connected=presence.ref('.info/connected'),ownConnections=presence.ref('onlinePresence/'+id+'/'+owner+'/connections');let onOwn=null;
 function watchOwn(snapshot){if(ctx.active&&ctx.ref&&!ctx.pending&&!snapshot.hasChild(ctx.ref.key)){connectionReady=false;render();retry();}}
 function retry(){if(!ctx.active||ctx.retry||(!ctx.transport&&ctx.access))return;ctx.retry=setTimeout(()=>{ctx.retry=null;repair();},Math.min(10000,1000*2**Math.min(ctx.failures++,4)));}
 async function repair(){
  if(!ctx.active||ctx.pending||!navigator.onLine||ctx.access&&!ctx.transport)return;
  if(connectionReady&&ctx.ref&&room?.members[owner]?.connected===true){recoverPending();return;}
  const epoch=ctx.epoch,ref=ctx.ref||ownConnections.push(),attempt=new AbortController();ctx.ref=ref;ctx.pending=true;ctx.attempt=attempt;
  const interrupted=new Promise((_,reject)=>attempt.signal.addEventListener('abort',()=>reject(Error('Presence attempt interrupted')),{once:true}));
  const timer=setTimeout(()=>attempt.abort(),15000),wait=p=>Promise.race([p,interrupted]);
  try{
   if(!ctx.access){await wait(api({operation:'presenceAccess',roomId:id}));if(!valid(epoch))return;ctx.access=true;}
   if(!onOwn)onOwn=ownConnections.on('value',watchOwn,()=>{if(ctx.active){onOwn=null;ctx.access=false;connectionReady=false;render();retry();}});
   if(!ctx.transport)return;
   await wait(ref.onDisconnect().remove());if(!valid(epoch))return;
   await wait(ref.set(true));if(!valid(epoch))return;
   const result=await wait(api({operation:'presenceSync',roomId:id}));if(!valid(epoch))return;
   if(!result.connected)throw Error('Presence acknowledgement pending');
   connection=ref;connectionReady=true;ctx.failures=0;if(ctx.retry){clearTimeout(ctx.retry);ctx.retry=null;}recoverPending();render();
  }catch(e){if(valid(epoch)){if(attempt.signal.aborted){ctx.epoch++;ctx.ref=null;}connectionReady=false;render();retry();}}
  finally{
   clearTimeout(timer);if(ctx.attempt===attempt)ctx.attempt=null;ctx.pending=false;
   if(!valid(epoch)){ref.remove().catch(()=>{});if(ctx.active&&ctx.transport)retry();}
  }
 }
 const onTransport=connected.on('value',snapshot=>{
  if(!ctx.active)return;const wasConnected=ctx.transport;ctx.transport=snapshot.val()===true;
  if(!ctx.transport){if(wasConnected){ctx.epoch++;ctx.ref=null;connection=null;ctx.attempt?.abort();}connectionReady=false;render();}
  else repair();
 });
 // A real data subscription keeps the RTDB transport active and detects lost registrations.
 const watchdog=setInterval(()=>{if(!document.hidden){repair();recoverPending();}},15000);
 presenceRecovery=repair;repair();
 unsubs.push(()=>{clearInterval(watchdog);ctx.active=false;ctx.epoch++;ctx.attempt?.abort();clearTimeout(ctx.retry);connected.off('value',onTransport);if(onOwn)ownConnections.off('value',onOwn);if(ctx.ref)ctx.ref.remove().catch(()=>{});if(presenceRecovery===repair)presenceRecovery=null;});
}
