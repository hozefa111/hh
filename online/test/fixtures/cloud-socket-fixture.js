// Emulator/browser-only harness. Runs the bundled production connection code;
// its API and sockets are isolated, with no production requests or private data.
window.socketRecoveryFixture=async function(mode,scenario){
 const real={setTimeout,clearTimeout,setInterval,clearInterval,WebSocket,api,recoverPending},descriptor=Object.getOwnPropertyDescriptor(performance,'now');let now=0,serial=0;
 const timers=new Map(),sockets=[],calls=[],schedule=(fn,ms,repeat)=>{const id=++serial;timers.set(id,{fn,at:now+ms,repeat,ms});return id;};
 async function drain(){for(let n=0;n<8;n++)await Promise.resolve();}
 async function advance(ms){const until=now+ms;for(;;){let hit;for(const [id,t]of timers)if(t.at<=until&&(!hit||t.at<hit[1].at))hit=[id,t];if(!hit)break;const [id,t]=hit;now=t.at;if(t.repeat)t.at+=t.ms;else timers.delete(id);t.fn();await drain();}now=until;await drain();}
 class FakeSocket{constructor(){this.readyState=0;sockets.push(this);}open(){this.readyState=1;this.onopen();}message(value){this.onmessage({data:typeof value==='string'?value:JSON.stringify(value)});}send(){}close(){this.readyState=2;}closed(){this.readyState=3;this.onclose();}}
 unsubs.forEach(f=>f());unsubs=[];clearCollection();
 try{
  Object.defineProperty(performance,'now',{configurable:true,value:()=>now});window.setTimeout=(fn,ms)=>schedule(fn,ms,false);window.setInterval=(fn,ms)=>schedule(fn,ms,true);window.clearTimeout=window.clearInterval=id=>timers.delete(id);window.WebSocket=FakeSocket;
  api=async body=>{calls.push(body);return {ticket:'a'.repeat(32)};};recoverPending=()=>{};
  let canonical=R.create({id:'cf2_'+ 'a'.repeat(32),code:'V2ABCDEF',uid:'admin',playerId:'p0',name:'Admin',mode},Date.now());
  canonical=R.command(canonical,'human',{type:'join',playerId:'p1',name:'Human'},Date.now());canonical=R.command(canonical,'human',{type:'claimSeat',seat:2},Date.now());for(let seat=3;seat<=mode;seat++)canonical=R.command(canonical,'admin',{type:'bot',seat,botId:'bot_'+seat},Date.now());
  const send=(uid,action)=>canonical=R.command(canonical,uid,action,Date.now(),n=>n-1);send('human',{type:'ready'});send('admin',{type:'ready'});while(canonical.hand.phase==='auction')send(canonical.hand.turn,{type:'bid',...(canonical.hand.finalBid?{keep:true}:{pass:true})});send('admin',{type:'trump',suit:'H'});send('admin',{type:'partners',called:R.deck(mode,canonical.config).find(c=>!canonical.hand.hands.admin.includes(c)),...(mode===6?{direct:'bot_3'}:{})});
  const pub=R.publicState(canonical),mine=R.privateState(canonical,'human');user={uid:'human',getIdToken:async()=>''};room=null;previous=null;own={cards:[]};busy=false;historyOpen=false;scoreOpen=false;screen='room';reduced=true;error='';connectionReady=false;subscribedRoomId=pub.id;
  const pending={roomId:pub.id,commandId:'original-command-unchanged',action:{type:'ready'}};uncertainCommand=pending;
  const state=revision=>({type:'state',room:Object.assign({},pub,{revision}),own:mine,serverNow:Date.now()});
  await attachCloudRoom(pub.id);const first=sockets[0];
  if(scenario==='handshake')await advance(17000);
  else{first.open();first.message(state(10));renderNow();
   if(scenario==='idle'){for(let n=0;n<12;n++){await advance(10000);first.message('pong');}return {sockets:sockets.length,requests:calls.length,connected:connectionReady,seat:room.members.human.seat};}
   await advance(31000);
  }
  const reconnecting=!connectionReady&&sockets.length>1,last=sockets[sockets.length-1];if(last===first)throw Error('No automatic socket recovery');last.open();last.message(state(12));renderNow();first.closed();first.message(state(99));
  return {reconnecting,connected:connectionReady,revision:room.revision,seat:room.members.human.seat,uid:uid(),sameCards:JSON.stringify(own.cards)===JSON.stringify(mine.cards),samePending:uncertainCommand===pending,ticketsOnly:calls.every(b=>b.operation==='socketTicket'),countMembers:Object.keys(room.members).length};
 }finally{unsubs.forEach(f=>f());unsubs=[];uncertainCommand=null;for(const key of ['setTimeout','clearTimeout','setInterval','clearInterval','WebSocket'])window[key]=real[key];api=real.api;recoverPending=real.recoverPending;if(descriptor)Object.defineProperty(performance,'now',descriptor);else delete performance.now;}
};
