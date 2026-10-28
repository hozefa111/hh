'use strict';
const {test}=require('node:test'),A=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(process.env.KALI_CLIENT_SOURCE||require('node:path').resolve(__dirname,'../client.js'),'utf8'),start=source.indexOf('async function attachCloudRoom('),code=source.slice(start,source.indexOf('\nasync function enter(',start));
function fixture(){
 let now=0,serial=0;const timers=new Map(),sockets=[],requests=[],listeners=new Map(),stored=new Map();
 const schedule=(fn,ms,repeat=false)=>{const id=++serial;timers.set(id,{fn,at:now+ms,repeat,ms});return id;};
 class Socket{constructor(){this.readyState=0;this.sent=[];sockets.push(this);}open(){this.readyState=1;this.onopen?.();}message(data){this.onmessage?.({data:typeof data==='string'?data:JSON.stringify(data)});}send(data){this.sent.push(data);}close(){this.readyState=2;}closed(){this.readyState=3;this.onclose?.();}}
 const c={WebSocket:Socket,URL,JSON,Math,console,navigator:{onLine:true},document:{hidden:false,addEventListener:(k,f)=>listeners.set(k,f),removeEventListener:k=>listeners.delete(k)},performance:{now:()=>now},localStorage:{setItem:(k,v)=>stored.set(k,v),getItem:k=>stored.get(k)||null,removeItem:k=>stored.delete(k)},setTimeout:(f,m)=>schedule(f,m),setInterval:(f,m)=>schedule(f,m,true),clearTimeout:id=>timers.delete(id),clearInterval:id=>timers.delete(id),
 subscribedRoomId:'cf2_'+ 'a'.repeat(32),uid:()=> 'same-human',host:'https://example.test/',room:null,own:{cards:[]},cloudRooms:[],roomPendingExports:0,connectionReady:false,loadingRoom:true,clockAnchor:{},error:'',previous:null,unsubs:[],busy:false,historyOpen:false,uncertainCommand:{commandId:'original-uncertain-move'},
 api:async b=>{requests.push(b);return {ticket:'a'.repeat(32)};},recoverPending(){},clearCollection(){c.cleared=(c.cleared||0)+1;},render(){},notice(){},stopHistory(){},receiveRoomSnapshot:r=>c.room=r,unavailableRoom(){throw Error('Unexpected loss of access');}};
 vm.createContext(c);vm.runInContext(code,c);
 async function drain(){for(let n=0;n<8;n++)await Promise.resolve();}
 async function advance(ms){const end=now+ms;for(;;){let hit;for(const [id,t]of timers)if(t.at<=end&&(!hit||t.at<hit[1].at))hit=[id,t];if(!hit)break;const [id,t]=hit;now=t.at;if(t.repeat)t.at+=t.ms;else timers.delete(id);t.fn();await drain();}now=end;await drain();}
 const state=revision=>({type:'state',room:{id:c.subscribedRoomId,code:'V2ABCDEF',revision,status:'playing',members:{'same-human':{seat:2}},hand:{id:'hand',phase:'playing',turn:'bot',turnGeneration:4}},own:{handId:'hand',cards:['5S']},serverNow:now});
 return {c,sockets,requests,state,advance,drain,listeners,timers};
}
test('a half-open game socket cannot remain ONLINE indefinitely after replies stop',async()=>{
 const f=fixture();await f.c.attachCloudRoom(f.c.subscribedRoomId);const first=f.sockets[0];first.open();first.message(f.state(10));A.equal(f.c.connectionReady,true);
 await f.advance(31000);A(f.sockets.length>1,'Silent OPEN socket must reconnect without requiring close/error or user action');A.equal(f.c.connectionReady,false);A.equal(f.c.uncertainCommand.commandId,'original-uncertain-move');
 const replacement=f.sockets.at(-1);replacement.open();replacement.message(f.state(12));A.equal(f.c.room.revision,12);A.equal(f.c.connectionReady,true);A.deepEqual(f.c.own.cards,['5S']);A.equal(f.requests.every(r=>r.operation==='socketTicket'),true);
 first.message(f.state(99));A.equal(f.c.room.revision,12,'Retired socket cannot overwrite recovered state');
});
test('healthy pong-only idle periods do not reconnect or poll the database',async()=>{
 const f=fixture();await f.c.attachCloudRoom(f.c.subscribedRoomId);const ws=f.sockets[0];ws.open();ws.message(f.state(10));for(let n=0;n<12;n++){await f.advance(10000);ws.message('pong');}A.equal(f.sockets.length,1);A.equal(f.requests.length,1);A.equal(f.c.connectionReady,true);
});
test('a handshake that never opens has a bounded recovery path',async()=>{
 const f=fixture();await f.c.attachCloudRoom(f.c.subscribedRoomId);await f.advance(17000);A(f.sockets.length>1,'CONNECTING socket without callbacks must not block every future reconnect');A.equal(f.c.connectionReady,false);A.equal(f.c.uncertainCommand.commandId,'original-uncertain-move');
});
test('backgrounding or leaving cancels watchdogs and cannot reconnect an old room',async()=>{
 const f=fixture();await f.c.attachCloudRoom(f.c.subscribedRoomId);const ws=f.sockets[0];ws.open();ws.message(f.state(10));f.c.document.hidden=true;f.listeners.get('visibilitychange')();await f.advance(60000);A.equal(f.sockets.length,1);f.c.document.hidden=false;f.listeners.get('visibilitychange')();await f.drain();A.equal(f.sockets.length,2);for(const dispose of f.c.unsubs)dispose();await f.advance(60000);A.equal(f.sockets.length,2);A.equal(f.timers.size,0);
});
test('failed proactive renewal keeps a healthy socket while a retired close cannot undo recovery',async()=>{
 const f=fixture();await f.c.attachCloudRoom(f.c.subscribedRoomId);const original=f.sockets[0];original.open();original.message(f.state(10));
 for(let n=0;n<24;n++){await f.advance(10000);original.message('pong');}A.equal(f.sockets.length,2);A.equal(f.c.connectionReady,true);
 await f.advance(10000);original.message('pong');await f.advance(7000);A.equal(f.c.connectionReady,true);A(f.sockets.length>=3,'Failed replacement must retry while retaining the original healthy channel');
 const next=f.sockets.at(-1);next.open();next.message(f.state(12));original.closed();A.equal(f.c.connectionReady,true);A.equal(f.c.room.revision,12);
});
