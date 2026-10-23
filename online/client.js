/* Same game UI for existing web app and embedded native Activity. */
'use strict';
document.documentElement.dataset.lobbyUi='scroll-dock-v1';
const R=KaliRules,root=document.getElementById('game');
const emulator=(window.KALI_EMULATOR===true||new URLSearchParams(location.search).get('emulator')==='1')&&['localhost','127.0.0.1','appassets.androidplatform.net'].includes(location.hostname);
const config=emulator?{...KALI_CONFIG,projectId:'demo-three-patti',apiKey:'demo-key',databaseURL:'https://demo-three-patti-default-rtdb.firebaseio.com'}:KALI_CONFIG;
firebase.initializeApp(config);const auth=firebase.auth(),db=firebase.firestore(),presence=firebase.database();
if(emulator){auth.useEmulator('http://'+(window.KALI_HOST||location.hostname)+':9099',{disableWarnings:true});db.useEmulator(window.KALI_HOST||location.hostname,8080);presence.useEmulator(window.KALI_HOST||location.hostname,9000);}
// Memory-only Firestore cache: private hands never enter persistent offline storage.
const host=emulator?'http://'+(window.KALI_HOST||location.hostname)+':5001/'+config.projectId+'/asia-south1/':(window.KALI_API_BASE||'https://asia-south1-'+config.projectId+'.cloudfunctions.net/');
let subscribedRoomId=null,loadingRoom=false,connectionReady=false,presenceRecovery=null,reconnectBusy=false;
let user=null,admin=false,room=null,own={cards:[]},profiles=[],memberships=[],unsubs=[],connection=null,clockAnchor={server:Date.now(),mono:performance.now()},busy=false,selected=null,previous=null,scoreOpen=false,historyOpen=false,historyMore=true,records=[],error='',screen='home';
let pendingSince=0;
// Memory-only, bounded and deliberately payload-free diagnostics.
const speedRows=[],speedSnapshots=new Map(),speedPending=new Set();
let uncertainCommand=null;
const localActions=new Set(['scores','history','close-panel','diagnostics','sound','motion','manage']);
const mutationBlocked=()=>busy||!!uncertainCommand;
function speedSample(operation){const row={operation:['bid','play','trump','partners','ready','pause','resume','join','create','clock','presenceSync','presenceAccess','exchange'].includes(operation)?operation:'other',mode:room?.mode||null,status:0,stages:{},started:performance.now()};speedRows.push(row);if(speedRows.length>200){const old=speedRows.shift();speedPending.delete(old);}return row;}
function speedReport(){const metrics={};for(const key of ['request','clientToken','queue','auth','read','begin','commit','presence','total','snapshot','frame','visible']){const values=speedRows.map(r=>r.stages[key]).filter(Number.isFinite).sort((a,b)=>a-b);if(values.length)metrics[key]={samples:values.length,medianMs:Math.round(values[Math.floor((values.length-1)*.5)]),p95Ms:Math.round(values[Math.ceil(values.length*.95)-1])};}return {version:1,scope:'Local session only; timings in milliseconds. Frame means a next-frame opportunity, not physical-display FPS.',metrics,samples:speedRows.map(({operation,mode,status,stages,error,background})=>({operation,mode,status,stages:{...stages},...(error?{error}:{}),...(background?{background:true}:{})}))};}
function speedSnapshot(id,revision){if(!Number.isFinite(revision))return;speedSnapshots.set(id+':'+revision,performance.now());if(speedSnapshots.size>64)speedSnapshots.delete(speedSnapshots.keys().next().value);}
function speedWatch(row,id,revision){if(!row||!Number.isFinite(revision))return;row.room=id;row.revision=revision;speedPending.add(row);speedFrame();}
function speedFrame(){if(document.hidden){for(const row of speedPending)row.background=true;speedPending.clear();return;}for(const row of speedPending){if(!room||room.id!==row.room){speedPending.delete(row);continue;}if(Number(root.dataset.revision)<row.revision||room.revision<row.revision)continue;const seated=room.hand?.seatMap.some(p=>p.uid===uid());if(R.active(room)&&seated&&(own.handId!==room.hand.id||own.cards.length!==room.hand.counts[uid()]))continue;if(row.frameQueued)continue;let at=speedSnapshots.get(row.room+':'+row.revision);if(at===undefined)for(const [key,time]of speedSnapshots)if(key.startsWith(row.room+':')&&Number(key.slice(row.room.length+1))>=row.revision)at=at===undefined?time:Math.min(at,time);if(at===undefined)continue;at=Math.max(row.started,at);row.stages.snapshot=Math.max(0,at-row.started);row.frameQueued=true;requestAnimationFrame(()=>requestAnimationFrame(()=>{if(!document.hidden&&room?.id===row.room&&Number(root.dataset.revision)>=row.revision){row.stages.frame=Math.max(0,performance.now()-at);row.stages.visible=performance.now()-row.started;}else row.background=true;speedPending.delete(row);}));}}
async function showSpeed(){const report=speedReport(),labels={request:'Request round trip',clientToken:'Device token',queue:'Room queue',auth:'Server identity',read:'Database reads',begin:'Transaction start',commit:'Database commit',presence:'Presence lookup',total:'Server total',snapshot:'Move to snapshot',frame:'Snapshot to next frame',visible:'Move to next frame'};const text=Object.entries(report.metrics).map(([k,v])=>`${labels[k]}: median ${v.medianMs} ms · p95 ${v.p95Ms} ms (${v.samples})`).join('\n');const choice=await gameDialog({title:'Connection & performance',message:(text||'No timing samples yet. Play a few turns, then check again.')+'\n\nLast 200 requests, on this device only. No names, cards or login tokens. Snapshot timings are available for moves; server stages require the updated free backend.',choices:[{value:'copy',label:'Copy report'},{value:'cancel',label:'Close'}]});if(choice==='copy'){const value=JSON.stringify(speedReport(),null,2);try{if(!navigator.clipboard?.writeText)throw Error();await navigator.clipboard.writeText(value);notice('Performance report copied');}catch{await gameDialog({title:'Copy performance report',message:'Select and copy this local timing report.',input:{label:'Report JSON',value,readOnly:true,maxLength:200000},choices:[{value:'cancel',label:'Close'}]});}}}

let renderFrame=null,motionQueue=[],collectionUntil=0,collectionTimer=null,pendingCollection=null;
let reduced=localStorage.getItem('kaliReducedMotion')==='true'||matchMedia('(prefers-reduced-motion: reduce)').matches;
// Sounds are synthesized locally: no downloads, microphone access or autoplay.
let soundEnabled=localStorage.getItem('kaliSound')==='true',audioContext=null,lastSoundTurn='',lastWarning='';
function unlockAudio(){if(!soundEnabled)return;try{const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;audioContext=audioContext||new Audio();if(audioContext.state==='suspended')audioContext.resume().catch(()=>{});}catch{}}
function playSound(kind){if(!soundEnabled||document.hidden||!audioContext||audioContext.state!=='running')return;try{const notes={card:[420],deal:[330,440,550],trump:[440,660],reveal:[523,659,784],trick:[520,780],turn:[660,880],warning:[440],tap:[340]}[kind]||[];notes.forEach((hz,i)=>{const o=audioContext.createOscillator(),g=audioContext.createGain(),t=audioContext.currentTime+i*.085;o.type='sine';o.frequency.value=hz;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.055,t+.008);g.gain.exponentialRampToValueAtTime(.001,t+.075);o.connect(g);g.connect(audioContext.destination);o.start(t);o.stop(t+.08);o.onended=()=>{o.disconnect();g.disconnect();};});}catch{}}
document.addEventListener('pointerdown',unlockAudio,{passive:true});
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>user?.uid,name=id=>room?.members[id]?.name||'Player';
const btn=(text,action,disabled=false,style='')=>`<button ${disabled||((busy||uncertainCommand)&&!localActions.has(action)&&action!=='retry-move')?'disabled':''} data-action="${esc(action)}" class="${style}">${text}</button>`;
const sign=n=>(n>0?'+':'')+n, suit=s=>R.SYMBOLS[s]||'—';
const cardHTML=(c,extra='')=>{const v=R.card(c);return `<span class="face ${['H','D'].includes(v.suit)?'red':''} ${extra}"><b>${v.rank}</b><i>${suit(v.suit)}</i><small>${R.points(c)} pts</small></span>`;};
function notice(s){document.getElementById('notice').textContent=s;setTimeout(()=>document.getElementById('notice').textContent='',6000);}
let activeDialog=null;
function gameDialog({title,message,choices,input=null}){
 if(activeDialog)activeDialog(null);
 return new Promise(resolve=>{
  const focused=document.activeElement,layer=document.createElement('div');layer.className='game-dialog-layer';
  layer.innerHTML=`<section class="game-dialog" role="dialog" aria-modal="true" aria-labelledby="game-dialog-title" aria-describedby="game-dialog-description"><span class="eyebrow">♠ 3 PATTI PRO</span><h2 id="game-dialog-title">${esc(title)}</h2><p id="game-dialog-description">${esc(message)}</p>${input?`<label>${esc(input.label)}<input name="dialogValue" maxlength="${input.maxLength||80}" value="${esc(input.value||'')}" ${input.readOnly?'readonly':''}></label>`:''}<div class="game-dialog-actions">${choices.map(c=>`<button type="button" data-choice="${esc(c.value)}" class="${c.style||''}"><b>${esc(c.label)}</b>${c.description?`<small>${esc(c.description)}</small>`:''}</button>`).join('')}</div></section>`;
  const close=value=>{if(activeDialog!==close)return;activeDialog=null;layer.remove();root.removeAttribute('aria-hidden');if(focused?.isConnected)focused.focus({preventScroll:true});resolve(value);};activeDialog=close;
  layer.addEventListener('click',e=>{const button=e.target.closest('[data-choice]');if(button){const value=button.dataset.choice;close(value==='cancel'?null:input&&value==='confirm'?layer.querySelector('input').value:value);}else if(e.target===layer)close(null);});
  layer.addEventListener('keydown',e=>{
   if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(null);}
   else if(e.key==='Tab'){const fields=Array.from(layer.querySelectorAll('input,button')),index=fields.indexOf(document.activeElement),next=(index+(e.shiftKey?-1:1)+fields.length)%fields.length;e.preventDefault();fields[next].focus();}
   else if(e.key==='Enter'&&e.target.tagName==='INPUT'&&!input?.readOnly){e.preventDefault();close(e.target.value);}
  });
  document.body.appendChild(layer);root.setAttribute('aria-hidden','true');const first=layer.querySelector('input')||layer.querySelector('[data-choice="cancel"]')||layer.querySelector('button');first.focus({preventScroll:true});
 });
}
window.kaliDismissDialog=()=>{if(!activeDialog)return false;activeDialog(null);return true;};
function askConfirm(title,message,label='Confirm'){return gameDialog({title,message,choices:[{value:'confirm',label,style:'danger'},{value:'cancel',label:'Cancel'}]}).then(value=>value==='confirm');}
async function api(body,endpoint='kaliApi'){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),25000),row=speedSample(body.action?.type||body.operation||endpoint);let received=false;
 try{
 const headers={'Content-Type':'application/json'};if(user){const start=performance.now(),aborted=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new Error('Connection timed out.')),{once:true}));try{headers.Authorization='Bearer '+await Promise.race([user.getIdToken(),aborted]);}finally{row.stages.clientToken=performance.now()-start;}}
 const res=await fetch(host+endpoint,{method:'POST',headers,body:JSON.stringify(body),cache:'no-store',signal:controller.signal});received=true;row.status=res.status;
 const timingPattern=/([a-zA-Z]+);dur=([0-9.]+)/g;let match;while((match=timingPattern.exec(res.headers.get('Server-Timing')||''))!==null)if(['queue','auth','read','begin','commit','presence','total'].includes(match[1]))row.stages[match[1]]=Number(match[2]);
 let value;try{value=await res.json();}catch{const e=Error('Game server unavailable. Check deployment and connection.');e.retryable=true;throw e;}
 if(!res.ok){const e=Error(value.error||'Action failed');e.retryable=res.status>=500||/^Server connection/.test(value.error||'');throw e;}
 if(value.serverNow)clockAnchor={server:value.serverNow,mono:performance.now()};if(body.roomId&&body.action)speedWatch(row,body.roomId,value.revision);return value;
 }catch(e){row.error=controller.signal.aborted?'timeout':received?'rejected':'network';if(controller.signal.aborted){const error=Error('Connection timed out. Your table state is preserved; reconnect and retry.');error.retryable=true;throw error;}if(!received)e.retryable=true;throw e;}finally{clearTimeout(timeout);row.stages.request=performance.now()-row.started;}
}

function disableControls(){renderedMarkup=null;root.querySelectorAll('button').forEach(b=>{if(!localActions.has(b.dataset.action)&&!(b.dataset.action==='retry-move'&&!busy))b.disabled=true;});}
async function submitMove(body){const owner=uid(),current=()=>room?.id===body.roomId&&uid()===owner;busy=true;pendingSince=performance.now();disableControls();render();try{await api(body);if(current())uncertainCommand=null;return true;}catch(e){if(current())uncertainCommand=e.retryable?body:null;notice(e.message);return false;}finally{busy=false;pendingSince=0;render();}}
async function command(action){if(!room||busy)return;if(uncertainCommand){notice('Confirm your pending move before choosing another action.');return false;}if(!navigator.onLine){notice('Offline. Reconnect to continue.');return false;}return submitMove({roomId:room.id,revision:room.revision,handId:room.hand?.id,turnGeneration:room.hand?.turnGeneration,commandId:crypto.randomUUID(),action});}

function seatConnected(){const me=room?.members[uid()];return !!(navigator.onLine&&connectionReady&&me?.connected===true&&me.status!=='Disconnected');}
function recoveryPanel(){if(room&&uncertainCommand?.roomId===room.id)return `<section class="connection-recovery" role="status"><span>Still waiting for confirmation. Retry your last move.</span>${btn(busy?'Sending…':'Retry pending move','retry-move',busy)}</section>`;return room&&room.status!=='stopped'&&!seatConnected()?`<section class="connection-recovery" role="status"><span>${navigator.onLine?'Restoring your seat…':'Offline · reconnect when internet returns'}</span>${btn(reconnectBusy?'Retrying…':'↻ Reconnect','reconnect',reconnectBusy)}</section>`:'';}
function missingPlayers(){return R.active(room)?room.hand.seatMap.filter(p=>p.kind!=='bot'&&!room.members[p.uid].connected):[];}
function pauseControl(){return room.admin===uid()&&room.status!=='stopped'?btn(room.paused?'Resume':'Pause',room.paused?'resume':'pause',room.paused&&missingPlayers().length>0):'';}
function pauseBanner(){if(!room.paused)return '';const missing=missingPlayers(),owner=room.admin===uid();return `<section class="pause-banner"><h2>Ⅱ Game paused</h2><p>${missing.length?'Waiting for '+missing.map(p=>esc(name(p.uid))).join(', ')+'. Their seats, cards and remaining time are preserved.':'Admin paused the table. Cards and remaining time are preserved.'}</p><div class="pause-actions">${owner?btn('Resume game','resume',missing.length>0)+(R.active(room)?btn('Void hand & replace player','void-replace',false,'danger'):''):'<p>Reconnect to your existing seat. The admin resumes when everyone is connected.</p>'}</div>${owner&&missing.length?'<p class="muted">Wait for reconnection, or void this unfinished hand before choosing a replacement. Completed scores stay saved.</p>':''}</section>`;}
function leaveRoomView(){uncertainCommand=null;window.kaliDismissDialog();clearCollection();subscribedRoomId=null;room=null;own={cards:[]};previous=null;selected=null;loadingRoom=false;error='';screen='home';unsubs.forEach(f=>f());unsubs=[];if(connection){const old=connection;connection=null;old.remove().catch(()=>{});}connectionReady=false;render();}

async function reconnectSeat(){
 if(!room||!user||reconnectBusy)return;if(!navigator.onLine){notice('Offline. Turn on your internet, then tap Reconnect.');return;}
 const id=room.id;reconnectBusy=true;render();
 try{
  if(seatConnected()){const reply=await api({operation:'presenceSync',roomId:id});if(reply.connected){notice('Your seat is connected.');return;}}
  notice('Reconnecting to your existing seat…');presence.goOffline();presence.goOnline();await enter(id);
  const until=Date.now()+15000;while(subscribedRoomId===id&&!seatConnected()&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,100));
  if(subscribedRoomId!==id)return;notice(seatConnected()?'Connected · your seat and cards are restored.':'Still reconnecting. Check your internet; your game state is preserved.');
 }catch(e){notice(e.message||'Reconnect failed. Your game state is preserved.');}finally{reconnectBusy=false;render();}
}
function header(){return `<header><a href="../index.html" class="brand">♠ <span>3 PATTI <b>PRO</b></span></a><span class="connection ${navigator.onLine?'':'offline'}">${!navigator.onLine?'● RECONNECTING':room&&!seatConnected()?'○ RECONNECTING':'● ONLINE'}</span>${room?btn('Rooms','home',false,'quiet'):''}${btn(soundEnabled?'Sound on':'Sound off','sound',false,'quiet')}${btn(reduced?'Motion off':'Motion on','motion',false,'quiet')}</header>`;}
function home(){const activeRooms=memberships.filter(r=>!['stopped','Removed'].includes(r.status));return `<section class="hero"><span class="eyebrow">THE SAME GAME. NOW AT YOUR TABLE.</span><div class="hero-cards">${cardHTML('AS')}${cardHTML('3S')}${cardHTML('AH')}</div><h1>Kali Ki Tidi</h1><p>250 points. One Hukum. Your next great hand.</p>${btn('Check connection speed','diagnostics',false,'quiet')}</section><section class="home-grid"><form id="join"><h2>Join your table</h2><label>Your name<select name="playerId" required><option value="">Select from existing Players</option>${profiles.map(p=>`<option value="${esc(p.id)}" ${localStorage.getItem('kaliPlayerId')===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><p class="muted">Choose your existing name, then take an empty seat. No admin approval needed.</p><label>Room code<input name="code" required maxlength="8" pattern="[A-Za-z2-9]{8}" value="${esc(new URLSearchParams(location.hash.slice(1)).get('join')||'')}" autocapitalize="characters"></label><button class="gold" ${mutationBlocked()?'disabled':''}>Join game →</button></form>${admin?`<form id="create"><h2>Create a table</h2><label>Session name<input name="sessionName" required maxlength="80" placeholder="e.g. Huzefa house · Friday"></label><label>Your player profile<select name="playerId" required>${profiles.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label><label>Players<select name="mode"><option value="4">4 players · 40 cards</option><option value="6">6 players · 42 cards</option></select></label><details><summary>Deck configuration</summary><label>First six<select name="six1">${R.SUITS.map(s=>`<option ${s==='C'?'selected':''} value="${s}">${suit(s)} ${R.NAMES[s]}</option>`).join('')}</select></label><label>Second six<select name="six2">${R.SUITS.map(s=>`<option ${s==='D'?'selected':''} value="${s}">${suit(s)} ${R.NAMES[s]}</option>`).join('')}</select></label><label>Additional three<select name="extraThree">${['H','C','D'].map(s=>`<option value="${s}">${suit(s)} ${R.NAMES[s]}</option>`).join('')}</select></label></details><button class="gold" ${mutationBlocked()?'disabled':''}>Create room</button></form>`:location.hostname==='appassets.androidplatform.net'?(window.KALI_NATIVE_PENDING?`<section class="panel"><h2>Restoring your 3 Patti PRO identity…</h2><p>Your account and seats stay linked to this APK.</p></section>`:`<section class="panel"><h2>Create a room</h2><p class="muted">Sign in using the existing 3 Patti PRO Home account controls.</p><a class="native-login" href="../index.html?nativeLogin=1">Sign in on 3 Patti PRO Home →</a></section>`):`<form id="login"><h2>Admin sign in</h2><p class="muted">Use your existing 3 Patti PRO account to create and manage tables.</p><label>Email<input name="email" type="email" required autocomplete="username"></label><label>Password<input name="password" type="password" required autocomplete="current-password"></label><button>Sign in</button></form>`}</section><section class="panel"><h2>Your active rooms</h2><p class="muted">Completed sessions are in 3 Patti PRO → History → Sessions.</p>${activeRooms.length?activeRooms.map(r=>btn(`${esc(r.sessionName)} · ${esc(r.status)}`,'room:'+r.roomId,false,'room-link')).join(''):'<p class="muted">No active rooms. Create or join a table.</p>'}</section><details class="panel"><summary>How to play</summary><p>Clockwise play. Default bidder opens 155; raise by 5 or permanently PASS. Choose Hukum and call any card outside your hand. Follow suit when possible; trumping when void is optional. The called-card holder reveals only when that card is played.</p><p>A/K/Q/J/10 = 10 points, each 5 = 5, 3♠ = 30. All cards total 250. 3♠ can lose to trump. Four players: one secret partner. Six players: one direct and one secret partner, possibly the same person.</p><p>Win: bidder +2×bid, distinct partners +bid, opponents 0. Loss: bidder −bid, partners −rounded half bid, opponents +bid. Human bid/card turns last 30 seconds. Timeout passes or plays a legal card. Session ends only when admin stops it.</p></details>`;}
function liveRoom(){
 const owner=room.admin===uid(),panel=scoreOpen?'scores':historyOpen?'history':screen==='manage'?'manage':null;
 return `<section class="room-head live"><h1 title="${esc(room.sessionName)}">${esc(room.sessionName||room.code)}</h1><div class="room-actions">${btn('↗','share',false,'gold')}${pauseControl()}${owner?btn('Stop Session','stop',false,'danger'):''}</div></section>${table()}<nav class="toolbar live-tools" aria-label="Table options">${btn('Scores','scores')}${btn('History','history')}${owner?btn('Manage','manage'):btn('Leave','leave')}</nav>${panel?`<section class="table-drawer" role="dialog" aria-modal="true" aria-label="${panel==='scores'?'Session scores':panel==='history'?'Hand history':'Manage table'}"><div class="drawer-top"><strong>${panel==='scores'?'Session scores':panel==='history'?'Hand history':'Manage table'}</strong>${btn('Close','close-panel')}</div><div class="drawer-body">${panel==='scores'?btn('↻ Reconnect','reconnect',reconnectBusy)+btn('Check speed','diagnostics')+scoreboard():panel==='history'?history():btn('Rename session','rename-session')+management()}</div></section>`:''}${pauseBanner()}`;
}
function lobby(){if(R.active(room))return liveRoom();const me=room.members[uid()],isOwner=room.admin===uid(),seated=R.ordered(room),hasHand=R.active(room);return `<section class="room-head ${hasHand?'live':''}"><div><span class="eyebrow">${room.mode} PLAYERS · 250 POINTS</span><h1>${esc(room.sessionName||'Table '+room.code)}</h1><p class="room-code">Room ${esc(room.code)}</p><p>Clockwise seats · ${room.status==='stopped'?'Session complete':'Session stays open until admin stops it'}</p></div><div class="room-actions">${btn('↗ Invite','share',false,'gold')}${isOwner&&room.status!=='stopped'?btn('Stop Session','stop',false,'danger'):''}</div></section>${hasHand?table():`<div class="lobby-seats">${Array.from({length:room.mode},(_,i)=>{const p=seated.find(p=>p.seat===i+1);return `<article data-seat="${i+1}" class="seat-card ${p?.uid===uid()?'self':''}"><span class="seat-number">SEAT ${i+1}</span><div class="avatar">${p?.kind==='bot'?'♟':esc((p?.name||'?').slice(0,1).toUpperCase())}</div><h3>${esc(p?.name||'Empty seat')}</h3><span class="badge">${p?(p.kind==='bot'?'COMPUTER':'HUMAN'):'OPEN'}</span><p>${p?status(p):'Ready for a player'}</p>${!p&&room.status!=='stopped'?`${me?.approved?btn('Take seat '+(i+1),'claim-seat:'+(i+1),busy,'gold'):''}${isOwner?btn('+ Computer','bot:'+(i+1)):''}`:''}</article>`;}).join('')}</div>`}${room.lastResult&&!hasHand?results():''}${room.status==='stopped'?`<section class="panel"><h2>Final session scorecard</h2>${scoreboard()}<p>Completed hands are saved in 3 Patti PRO history.</p></section>`:''}<div class="toolbar">${room.status!=='stopped'?btn('↻ Reconnect','reconnect',reconnectBusy)+pauseControl():''}${btn('Session scores','scores')}${btn('Hand history','history')}${isOwner?btn('Manage table','manage')+btn('Rename session','rename-session'):btn('Leave room','leave',room.status==='stopped')}</div>${scoreOpen?`<section class="panel"><h2>Current session · starts from zero</h2>${btn('Check speed','diagnostics')}${scoreboard()}</section>`:''}${historyOpen?history():''}${isOwner&&screen==='manage'?management():''}${pauseBanner()}`;}
function lobbyReady(){
 const me=room.members[uid()],isOwner=room.admin===uid(),seated=R.ordered(room);
 return `<section class="ready-bar lobby-ready" aria-label="Lobby readiness"><p>${room.paused?'Session paused · Admin must Resume before Ready.':R.allReadyExceptAdmin(room)?'Waiting for Admin to start next hand.':'Review your result, then mark Ready.'}</p>${me?.seat!==null&&me?.approved?btn(isOwner?(room.startedAt?'READY · Deal next hand':'READY · Start session'):me.ready?'✓ Ready':'I am READY','ready',room.paused||!seatConnected()||(isOwner?!R.allReadyExceptAdmin(room):me.ready),'gold'):`<p class="muted">${seated.length===room.mode?'All seats occupied. Waiting for a seat.':'Choose an empty seat to join.'}</p>${!me?.approved&&me?.requestedPlayerId?btn('Confirm my player profile','confirm-profile',busy,'gold'):''}`}</section>`;
}
let observedDock=null;
const dockObserver=typeof ResizeObserver==='function'?new ResizeObserver(()=>measureLobbyDock()):null;
function measureLobbyDock(){if(!observedDock)return;const height=Math.ceil(observedDock.getBoundingClientRect().height)+'px';if(document.documentElement.style.getPropertyValue('--lobby-dock-height')!==height)document.documentElement.style.setProperty('--lobby-dock-height',height);}
function observeLobbyDock(){const dock=root.querySelector('.lobby-ready');if(dock!==observedDock){if(observedDock)dockObserver?.unobserve(observedDock);observedDock=dock;if(dock){dockObserver?.observe(dock);measureLobbyDock();}}}
window.addEventListener('resize',measureLobbyDock,{passive:true});
function status(p){return !p.connected&&p.kind!=='bot'?'○ Disconnected':p.ready?'✓ Ready':esc(p.status);}
function table(){const h=room.hand,localCards=own.handId===h.id?own.cards:[],me=room.members[uid()],mySeat=me?.seat||1,turn=h.turn===uid(),canPlay=performance.now()>=collectionUntil&&seatConnected()&&turn&&h.phase==='playing'&&!room.paused&&!busy&&own.handId===h.id&&own.cards.length===h.counts[uid()],legal=canPlay?R.legal(localCards,h.trick):[];
 const last=h.tricks.at(-1),collecting=performance.now()<collectionUntil,trick=collecting?[]:h.trick;return `<section class="game-meta"><span>HUKUM <b>${suit(h.trump)} ${h.trump?R.NAMES[h.trump]:'Choosing'}</b></span><span>${h.phase==='auction'?'CURRENT BID':'CONTRACT'} <b>${h.bid} · ${esc(name(h.bidder))}</b></span><span>CALLED <b>${h.called?esc(h.called.slice(0,-1))+suit(h.called.slice(-1)):'—'}</b></span></section>${partnerStatus(h)}<div class="table-wrap"><div class="felt"><div class="table-mark">3 PATTI <b>PRO</b><small>HAND ${h.number} · TRICK ${Math.min(h.tricks.length+1,h.mode===4?10:7)}</small></div>${h.seatMap.map(p=>{const angle=((p.seat-mySeat+room.mode)%room.mode)*2*Math.PI/room.mode,x=50-Math.sin(angle)*40,y=50+Math.cos(angle)*39;return `<div data-player="${esc(p.uid)}" class="table-seat ${h.turn===p.uid?'current':''} ${p.uid===uid()?'self':''} ${last?.winner===p.uid?'trick-winner':''}" style="left:${x}%;top:${y}%"><div class="avatar">${p.kind==='bot'?'♟':esc(p.name.slice(0,1).toUpperCase())}</div><strong>${esc(p.name)}</strong><small>#${p.seat} · ${p.kind==='bot'?'BOT · ':''}${h.counts[p.uid]} cards · ${h.tricks.filter(t=>t.winner===p.uid).length} tricks</small><span>${room.members[p.uid].connected?'':'○ Offline · '}${h.bidder===p.uid?'♛ Bidder':h.direct===p.uid?'Direct partner':h.revealed&&h.secret===p.uid?'✦ Called partner':''}</span></div>`;}).join('')}<div class="centre-trick" data-players="${room.mode}" data-trick="${h.tricks.length}">${trick.map(p=>`<div data-player="${esc(p.uid)}" class="played-card ${p.automatic?'automatic':''}">${cardHTML(p.card)}<small>${esc(name(p.uid))}${p.reason==='timeout'?' · Timeout':p.reason==='bot'?' · Bot':p.automatic?' · Auto':''}</small></div>`).join('')}</div></div></div>${last?`<p class="last-trick" role="status">✓ ${esc(name(last.winner))} won trick ${h.tricks.length} · +${last.points} captured points</p>`:''}<section class="turn-bar"><span class="turn-label">${room.paused?'Paused':collecting?'Collecting trick…':turn?'Your turn':esc(name(h.turn))+'’s turn'}</span><strong>${esc(h.phase.toUpperCase())}</strong><span id="countdown" class="timer" aria-label="Turn time remaining">—</span></section><p class="hand-hint" aria-live="polite">${busy?'Sending your move…':'Your cards · All visible · Glowing cards are playable'}</p><section class="my-hand" aria-label="Your cards"><div class="hand-fan" style="--hand-cols:${localCards.length>8?5:localCards.length>4?4:Math.max(1,localCards.length)}">${localCards.map((c,i)=>`<button class="hand-card ${legal.includes(c)?'legal':canPlay?'dim':'waiting'} ${selected===c?'selected':''}" style="--i:${i};--count:${localCards.length}" data-action="card:${c}" ${!legal.includes(c)?'disabled':''} aria-label="${esc(R.card(c).rank+' '+R.NAMES[R.card(c).suit])}">${cardHTML(c)}</button>`).join('')}</div></section><section class="phase-area">${selected&&canPlay?`<div class="play-confirm">${btn('Play '+esc(selected),'confirm-card',false,'gold')}${btn('Cancel','cancel-card')}</div>`:''}${turn&&seatConnected()&&!room.paused&&own.handId===h.id?phaseControls(h):`<p class="phase-caption">${room.paused?'Cards and time preserved':!seatConnected()?'Reconnecting to your seat…':h.phase==='auction'?'Bidding clockwise · 30s timeout = PASS':h.phase==='trump'?'Bidder is choosing Hukum':h.phase==='partners'?'Bidder is choosing partners':'Follow the glowing cards when it is your turn'}</p>`}</section><details class="panel auction"><summary>Bidding history · ${h.bid}</summary>${h.auction.map(a=>`<p>${esc(name(a.uid))} <b>${a.pass?'PASS':a.bid}</b> ${a.reason==='timeout'?'· timeout PASS':a.reason==='bot'?'· computer':a.automatic?'· automatic':''}</p>`).join('')}<p>Passed: ${h.passed.map(name).map(esc).join(', ')||'None'}</p></details>`;}
function partnerStatus(h){
 if(!h.called)return '';
 if(!h.revealed)return `<section class="partner-status secret" aria-live="polite"><b>✦ ${h.direct?'Direct partner: '+esc(name(h.direct)):'Secret partner'}</b><span>Called ${esc(h.called.slice(0,-1))}${suit(h.called.slice(-1))} · holder stays secret until this card is played</span></section>`;
 const partners=[...new Set(h.partners||[h.direct,h.secret].filter(Boolean))];
 return `<section class="partner-status revealed" aria-live="polite"><b>✦ ${h.bidder===uid()?'Your partner'+(partners.length>1?'s':''):'Hukum partners'}: ${partners.map(name).map(esc).join(' & ')}</b><span>${esc(name(h.secret))} played ${esc(h.called.slice(0,-1))}${suit(h.called.slice(-1))}${h.secret===h.direct?' · Direct and called-card partner are the same player':''}</span></section>`;
}
function clearCollection(){clearTimeout(collectionTimer);collectionTimer=null;pendingCollection=null;collectionUntil=0;document.querySelectorAll('.trick-flight,.trick-announcement').forEach(el=>el.remove());}
function collectTrick(trick){
 playSound('trick');clearCollection();if(!trick||document.hidden)return;
 const felt=document.querySelector('.felt'),seat=document.querySelector('.table-seat[data-player="'+CSS.escape(trick.winner)+'"]');
 if(!felt||!seat)return;
 const area=felt.getBoundingClientRect(),target=seat.getBoundingClientRect(),duration=reduced?300:850;
 collectionUntil=performance.now()+duration;
 const announcement=document.createElement('div');announcement.className='trick-announcement';announcement.setAttribute('role','status');announcement.textContent=name(trick.winner)+' won the trick · +'+trick.points+' captured points';document.body.appendChild(announcement);
 pendingCollection={trick,area,target};
 collectionTimer=setTimeout(()=>{clearCollection();render();},duration);
}
function animateCollection(){
 if(!pendingCollection)return;const {trick,area:oldArea,target:oldTarget}=pendingCollection;pendingCollection=null;
 const area=document.querySelector('.felt')?.getBoundingClientRect()||oldArea,target=document.querySelector('.table-seat[data-player="'+CSS.escape(trick.winner)+'"]')?.getBoundingClientRect()||oldTarget;
 if(!reduced){const flight=document.createElement('div');flight.className='trick-flight';flight.dataset.winner=trick.winner;flight.style.setProperty('--flight-cols',trick.cards.length===6?3:2);flight.style.left=(area.x+area.width/2)+'px';flight.style.top=(area.y+area.height/2)+'px';
  flight.innerHTML=trick.cards.map((p,i)=>`<div class="flight-card" style="--flight-index:${i};--flight-count:${trick.cards.length}">${cardHTML(p.card)}</div>`).join('');document.body.appendChild(flight);
  const dx=target.x+target.width/2-area.x-area.width/2,dy=target.y+target.height/2-area.y-area.height/2;
  flight.animate([{transform:'translate(-50%,-50%) scale(1)',opacity:1},{transform:'translate(-50%,-50%) scale(1.05)',opacity:1,offset:.22},{transform:'translate(calc(-50% + '+dx+'px),calc(-50% + '+dy+'px)) scale(.2)',opacity:0}],{duration:800,easing:'ease-in-out',fill:'forwards'});
 }
}
function phaseControls(h){if(h.phase==='auction'){
 const timeout='<p class="bid-timeout-note">30 seconds · No bid = automatic PASS</p>';
 if(h.bid>=250)return `<section class="max-bid-state" aria-live="polite"><strong>Maximum bid reached</strong><span>250 · ${esc(name(h.bidder))}</span>${timeout}${btn('PASS','pass')}</section>`;
 return `<form id="bid" class="bid-controls" data-hand="${esc(h.id)}" data-generation="${h.turnGeneration}" data-base-bid="${h.bid}"><div class="bid-shortcuts">${timeout}<button type="button" data-action="bid-max">Max 250</button></div><div class="action-bar"><button type="button" data-action="bid-down" aria-label="Decrease Hukum bid by five">−</button><label>Hukum bid<select name="bid" aria-label="Choose Hukum bid">${Array.from({length:(250-h.bid)/5},(_,i)=>h.bid+5+i*5).map(n=>`<option>${n}</option>`).join('')}</select></label><button type="button" data-action="bid-up" aria-label="Increase Hukum bid by five">+</button><button class="gold" ${mutationBlocked()?'disabled':''}>Bid ${h.bid+5}</button>${btn('PASS','pass')}</div></form>`;
 }
 if(h.phase==='trump')return `<section class="panel"><h2>Choose Hukum</h2><div class="suit-picker">${R.SUITS.map(s=>btn(suit(s)+' '+R.NAMES[s],'trump:'+s,false,['H','D'].includes(s)?'red':'')).join('')}</div></section>`;
 if(h.phase==='partners')return `<form id="partners" class="panel"><h2>Choose your partner${room.mode===6?'s':''}</h2>${room.mode===6?`<label>Direct partner<select name="direct">${h.seatMap.filter(p=>p.uid!==uid()).map(p=>`<option value="${esc(p.uid)}">${esc(p.name)}</option>`).join('')}</select></label>`:''}<label>Call any card outside your hand<select name="called">${R.deck(room.mode,h.config).filter(c=>!own.cards.includes(c)).map(c=>`<option value="${c}">${c.slice(0,-1)}${suit(c.slice(-1))} · ${R.points(c)} points</option>`).join('')}</select></label><p class="muted">Holder stays secret until this card is played. It may be your direct partner.</p><button class="gold" ${mutationBlocked()?'disabled':''}>Confirm partners</button></form>`;return '';}
function scoreboard(){const rows=R.standings(room,room.status==='stopped');if(!rows.length)return '<p>No completed hands. No winner was recorded.</p>';return `<div class="score-list">${rows.map(p=>{const m=Object.values(room.members).find(m=>m.playerId===p.id);return `<div class="score-row"><span class="rank">${p.rank===1?'♛':p.rank}</span><span><b>${esc(p.name)}</b><small>${m?.kind==='bot'?'COMPUTER · session only':'HUMAN'}${m?.seat===null?' · former/waiting':''}</small></span><strong class="${p.score<0?'negative':'positive'}">${sign(p.score)}</strong></div>`;}).join('')}</div>`;}
function results(){const r=room.lastResult;return `<section class="panel result"><span class="eyebrow">HAND COMPLETE · ${suit(r.trump)} HUKUM</span><h2 class="${r.result==='win'?'positive':'negative'}">Contract ${r.result==='win'?'won':'lost'}</h2><p>${esc(name(r.bidder))} bid <b>${r.bid}</b> · Team captured <b>${r.teamPoints}</b> / 250 · Opponents <b>${250-r.teamPoints}</b></p><p>Partners: ${r.partners.map(name).map(esc).join(', ')}</p><div class="result-grid">${r.seatMap.map(p=>`<div><b>${esc(p.name)}</b><small>${r.captured[p.uid]} captured</small><strong class="${r.scoreChanges[p.playerId]<0?'negative':'positive'}">${sign(r.scoreChanges[p.playerId])}</strong></div>`).join('')}</div></section>`;}
function history(){return `${room.hand?`<details class="panel"><summary>Bidding history · ${room.hand.bid}</summary>${room.hand.auction.map(a=>`<p>${esc(name(a.uid))}: ${a.pass?'PASS':a.bid}${a.reason==='timeout'?' · automatic timeout PASS':''}</p>`).join('')}</details>`:''}<section class="panel"><h2>Completed & voided hands</h2>${records.map(r=>`<details id="history-hand-${esc(r.handId)}"><summary>${esc(r.handId)} · ${r.void?'Voided':r.result==='win'?'Contract won':'Contract lost'}</summary>${r.void?'No scores awarded':`<p>Bid ${r.bid} · Captured ${r.teamPoints} · ${suit(r.trump)}</p>${r.seatMap.map(p=>`<p>${esc(p.name)}: ${sign(r.scoreChanges[p.playerId])}</p>`).join('')}`}</details>`).join('')||'<p>No completed hands yet.</p>'}${historyMore&&records.length?btn('Load older hands','older-history'):''}</section>`;}
function management(){const active=R.active(room),ps=Object.values(room.members).filter(p=>p.status!=='Removed');return `<section class="panel management"><h2>Manage table</h2><p class="muted">${active?'Seats stay locked until this hand completes or is voided.':'Replace with computer, or remove the outgoing player and let a waiting player take the empty seat. Seating changes reset readiness.'}</p>${ps.map(p=>`<div class="manage-person"><b>${esc(p.name)}</b><span>${p.kind==='bot'?'Computer':status(p)} · ${p.seat?'Seat '+p.seat:'Waiting'}</span>${!p.approved&&!p.reservation&&!active?`<form class="approve" data-target="${esc(p.uid)}"><select name="playerId">${profiles.map(x=>`<option value="${esc(x.id)}" ${p.requestedPlayerId===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select><button>Approve & link profile</button></form>`:''}${!active&&(p.approved||p.reservation)?`<form class="assign" data-target="${esc(p.uid)}"><select name="seat">${Array.from({length:room.mode},(_,i)=>`<option value="${i+1}">Seat ${i+1}</option>`).join('')}</select><button>Assign / Move</button></form>${p.uid!==room.admin?btn('Waiting','unseat:'+p.uid)+btn('Sit out','sitout:'+p.uid)+btn('Remove','remove:'+p.uid)+(p.kind==='human'&&p.seat!==null?btn('Replace with computer','replace-bot:'+p.uid):''):''}`:''}</div>`).join('')}${!active?`<form id="swap"><h3>Swap seats</h3><select name="target">${R.ordered(room).map(p=>`<option value="${esc(p.uid)}">${esc(p.name)}</option>`).join('')}</select><select name="other">${R.ordered(room).map(p=>`<option value="${esc(p.uid)}">${esc(p.name)}</option>`).join('')}</select><button>Swap</button></form><form id="reserve"><h3>Reserve existing player</h3><select name="playerId">${profiles.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select><button>Reserve profile</button></form><label>Computer difficulty<select id="difficulty"><option value="normal">Normal</option><option value="easy">Easy</option></select></label>`:''}${!active?`<form id="deck-config"><h3>Next-hand deck settings</h3>${room.mode===4?`<label>First six<select name="six1">${R.SUITS.map(s=>`<option value="${s}" ${room.config.sixSuits[0]===s?'selected':''}>${suit(s)} ${R.NAMES[s]}</option>`).join('')}</select></label><label>Second six<select name="six2">${R.SUITS.map(s=>`<option value="${s}" ${room.config.sixSuits[1]===s?'selected':''}>${suit(s)} ${R.NAMES[s]}</option>`).join('')}</select></label>`:''}<label>Additional three<select name="extraThree">${['H','C','D'].map(s=>`<option value="${s}" ${room.config.extraThree===s?'selected':''}>${suit(s)} ${R.NAMES[s]}</option>`).join('')}</select></label><button>Save deck & reset Ready</button></form>`:''}<div class="toolbar">${active?btn(room.paused?'Resume':'Pause',room.paused?'resume':'pause')+btn('Void interrupted hand','void',false,'danger'):''}</div></section>`;}
function updateBidControls(){
 const form=root.querySelector('#bid'),select=form?.querySelector('select');if(!select)return;
 const value=Number(select.value),minimum=room.hand.bid+5;
 if(form.querySelector('.gold').textContent!=='Bid '+value)form.querySelector('.gold').textContent='Bid '+value;
 form.querySelector('.gold').disabled=mutationBlocked()||!Number.isInteger(value)||value<minimum||value>250||value%5!==0;
 form.querySelector('[data-action=bid-down]').disabled=mutationBlocked()||value<=minimum;
 form.querySelector('[data-action=bid-up]').disabled=mutationBlocked()||value>=250;
 form.querySelector('[data-action=bid-max]').disabled=mutationBlocked()||value===250;
 select.disabled=mutationBlocked();
}
// Retain live controls, scroll containers and animation nodes across snapshots.
// Keys are scoped to siblings; private hands still come only from own state.
const renderSlots=new Set(['room-head','lobby-seats','lobby-ready','game-meta','partner-status','table-wrap','felt','table-mark','centre-trick','last-trick','turn-bar','hand-hint','my-hand','hand-fan','phase-area','live-tools','table-drawer','drawer-top','drawer-body','pause-banner','connection-recovery','drawer-scrim']);
function renderKey(node){
 if(node.nodeType!==1)return null;
 const tag=node.tagName;
 if(node.id)return tag+'#'+node.id;
 for(const field of ['data-action','data-player','data-seat','data-target','name'])if(node.hasAttribute(field))return tag+':'+field+':'+node.getAttribute(field);
 for(const cls of node.classList)if(renderSlots.has(cls))return tag+'.'+cls;
 return null;
}
function patchNode(node,next){
 if(node.nodeType!==1){if(node.nodeValue!==next.nodeValue)node.nodeValue=next.nodeValue;return;}
 // Countdown owns its transient text/style; tick() updates only on a new second.
 if(node.id==='countdown')return;
 for(const attr of Array.from(node.attributes))if(!next.hasAttribute(attr.name)&&!(node.tagName==='DETAILS'&&attr.name==='open'))node.removeAttribute(attr.name);
 for(const attr of Array.from(next.attributes))if(node.getAttribute(attr.name)!==attr.value)node.setAttribute(attr.name,attr.value);
 patchChildren(node,next);
}
function patchChildren(parent,next){
 const old=Array.from(parent.childNodes).filter(n=>!n.dataset?.transient),used=new Set(),keys=new Map();
 for(const n of old){const key=renderKey(n);if(key)keys.set(key,n);}
 let cursor=parent.firstChild;
 for(const wanted of Array.from(next.childNodes)){
  const key=renderKey(wanted);
  const node=key?keys.get(key):old.find(n=>!used.has(n)&&!renderKey(n)&&n.nodeType===wanted.nodeType&&(n.nodeType!==1||n.tagName===wanted.tagName));
  const match=node&&!used.has(node)&&node.nodeType===wanted.nodeType&&(node.nodeType!==1||node.tagName===wanted.tagName)?node:null;
  while(cursor?.dataset?.transient)cursor=cursor.nextSibling;
  if(match){used.add(match);if(match!==cursor)parent.insertBefore(match,cursor);patchNode(match,wanted);cursor=match.nextSibling;}
  else{const fresh=wanted.cloneNode(true);parent.insertBefore(fresh,cursor);}
 }
 for(const n of old)if(!used.has(n))n.remove();
}
let renderedMarkup=null,renderedView=null;
function patchGame(markup){if(markup===renderedMarkup)return;const template=document.createElement('template');template.innerHTML=markup;patchChildren(root,template.content);renderedMarkup=markup;}
function render(){if(renderFrame===null)renderFrame=requestAnimationFrame(renderNow);}
function renderNow(){if(renderFrame!==null)cancelAnimationFrame(renderFrame);renderFrame=null;root.dataset.revision=room?.revision??'';const view=(room?room.id+':'+(R.active(room)?'table':'lobby'):loadingRoom?'loading':'home');const newView=view!==renderedView;renderedView=view;
const drafts=Array.from(root.querySelectorAll('form')).map(f=>({id:f.id,target:f.dataset.target,context:f.id==='bid'?f.dataset.hand+':'+f.dataset.generation:null,values:Array.from(f.querySelectorAll('input,select')).map(i=>({name:i.name,value:i.value}))}));
const focus=document.activeElement,focused=focus?.name?{name:focus.name,form:focus.form?.id,start:focus.selectionStart}:null;document.body.classList.toggle('reduced',reduced);// publicState omits hand in a new lobby. toggle(token, undefined) toggles!
const live=!!(room&&R.active(room));document.body.classList.toggle('live-game',live);const dock=!!room&&!live&&room.status!=='stopped';document.body.classList.toggle('room-lobby',dock);document.body.classList.toggle('bidding',live&&room.hand.phase==='auction');patchGame(header()+`<main class="${live?'live-main':dock?'lobby-main':''}">${error?`<p class="error">${esc(error)}</p>`:''}${room?recoveryPanel()+lobby():loadingRoom?'<section class="panel"><h2>Connecting to your table…</h2><p>Restoring seats and your private hand.</p></section>':home()}</main>${dock?lobbyReady():''}<footer>3 PATTI PRO · Same players. Same scorecard.</footer>`);for(const draft of drafts){const form=Array.from(root.querySelectorAll('form')).find(f=>f.id===draft.id&&f.dataset.target===draft.target&&(draft.context===null||draft.context===f.dataset.hand+':'+f.dataset.generation));if(!form&&draft.id==='bid'){const fresh=document.getElementById('bid');if(fresh)fresh.elements.bid.selectedIndex=0;}if(form)for(const v of draft.values){const input=Array.from(form.elements).find(i=>i.name===v.name);if(input&&(!(input instanceof HTMLSelectElement)||Array.from(input.options).some(o=>o.value===v.value)))input.value=v.value;}}
updateBidControls();
if(focused){const f=document.getElementById(focused.form),i=f&&Array.from(f.elements).find(i=>i.name===focused.name);if(i&&document.activeElement!==i){i.focus({preventScroll:true});try{i.setSelectionRange(focused.start,focused.start);}catch{}}}
if(window.KALI_NATIVE_PENDING||mutationBlocked())disableControls();// Browser anchoring owns scrolling during snapshots. scrollTo cancels Android
// touch/fling; use it only for a real view transition, never a lobby refresh.
if(newView)window.scrollTo(0,0);observeLobbyDock();tick();animateCollection();
if(!reduced)for(const kind of motionQueue.splice(0)){
 if(kind==='card'&&performance.now()<collectionUntil){motionQueue.push('card');continue;}
 if(kind==='deal'&&!document.querySelector('.hand-card')&&room?.hand?.seatMap.some(p=>p.uid===uid())){motionQueue.push('deal');continue;}
 if(kind==='deal')document.querySelectorAll('.hand-card').forEach((c,i)=>c.animate([{opacity:.88},{opacity:1}],{duration:350,delay:i*20}));
 if(kind==='deal'){
 const felt=document.querySelector('.felt');if(felt){const centre=felt.getBoundingClientRect();document.querySelectorAll('.table-seat').forEach((seat,i)=>{const target=seat.getBoundingClientRect();for(let c=0;c<(room.mode===4?10:7);c++){const back=document.createElement('span');back.className='deal-back';back.dataset.transient='true';back.textContent='✦';felt.appendChild(back);const travel=back.animate([{transform:'translate(-50%,-50%)',opacity:.8},{transform:'translate(calc(-50% + '+(target.x+target.width/2-centre.x-centre.width/2)+'px),calc(-50% + '+(target.y+target.height/2-centre.y-centre.height/2)+'px)) scale(.6)',opacity:0}],{duration:320,delay:(c*room.mode+i)*20,fill:'both'});if(travel.finished)travel.finished.then(()=>back.remove(),()=>back.remove());else setTimeout(()=>back.remove(),350+(c*room.mode+i)*20);}});}
 }
 if(kind==='card'){const c=document.querySelector('.centre-trick .played-card:last-child');const from=c&&document.querySelector('.table-seat[data-player="'+CSS.escape(c.dataset.player)+'"]');if(c&&from){const a=from.getBoundingClientRect(),b=c.getBoundingClientRect();c.animate([{transform:'translate('+(a.x+a.width/2-b.x-b.width/2)+'px,'+(a.y+a.height/2-b.y-b.height/2)+'px) scale(.6)',opacity:.2},{transform:'translate(0,0) scale(1)',opacity:1}],{duration:300,easing:'ease-out'});}}

 if(kind==='trump'||kind==='reveal')document.querySelector(kind==='trump'?'.game-meta':'.partner-status')?.animate([{opacity:.2,transform:'scale(.97)'},{opacity:1,transform:'scale(1)'}],{duration:400});
} else motionQueue=[];
 speedFrame();
}
function tick(){if(document.hidden)return;if(busy&&pendingSince){const hint=root.querySelector('.hand-hint'),label=performance.now()-pendingSince>=3000?'Waiting for server… Please do not submit again.':'Sending your move…';if(hint&&hint.textContent!==label)hint.textContent=label;}const el=document.getElementById('countdown');if(!el||!room?.hand)return;const h=room.hand,key=h.id+':'+h.turnGeneration;if(!room.paused&&seatConnected()&&h.turn===uid()&&lastSoundTurn!==key){lastSoundTurn=key;playSound('turn');}const seconds=h.deadline===null?null:Math.max(0,Math.ceil((h.deadline-(clockAnchor.server+performance.now()-clockAnchor.mono))/1000));if(!room.paused&&seatConnected()&&h.turn===uid()&&seconds!==null&&seconds<=5&&seconds>0&&lastWarning!==key+':'+seconds){lastWarning=key+':'+seconds;playSound('warning');}const label=room.paused?'Ⅱ':room.members[h.turn]?.kind==='bot'?'…':seconds===null?'—':seconds+'s',urgent=room.members[h.turn]?.kind!=='bot'&&seconds!==null&&seconds<=5,time=Math.min(100,(seconds||0)/30*100)+'%',state=label+':'+urgent+':'+time;if(el._clockState!==state){el._clockState=state;if(el.textContent!==label)el.textContent=label;el.classList.toggle('urgent',urgent);el.style.setProperty('--time',time);}}
setInterval(tick,250);
async function attachPresence(id){
 const owner=uid(),ctx={active:true,transport:false,epoch:0,pending:false,ref:null,retry:null,failures:0,access:false,attempt:null};
 const valid=epoch=>ctx.active&&subscribedRoomId===id&&uid()===owner&&ctx.epoch===epoch;
 const connected=presence.ref('.info/connected'),ownConnections=presence.ref('onlinePresence/'+id+'/'+owner+'/connections');let onOwn=null;
 function watchOwn(snapshot){if(ctx.active&&ctx.ref&&!ctx.pending&&!snapshot.hasChild(ctx.ref.key)){connectionReady=false;render();retry();}}
 function retry(){if(!ctx.active||ctx.retry||(!ctx.transport&&ctx.access))return;ctx.retry=setTimeout(()=>{ctx.retry=null;repair();},Math.min(10000,1000*2**Math.min(ctx.failures++,4)));}
 async function repair(){
  if(!ctx.active||ctx.pending||!navigator.onLine||ctx.access&&!ctx.transport)return;
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
   connection=ref;connectionReady=true;ctx.failures=0;if(ctx.retry){clearTimeout(ctx.retry);ctx.retry=null;}render();
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
 presenceRecovery=repair;repair();
 unsubs.push(()=>{ctx.active=false;ctx.epoch++;ctx.attempt?.abort();clearTimeout(ctx.retry);connected.off('value',onTransport);if(onOwn)ownConnections.off('value',onOwn);if(ctx.ref)ctx.ref.remove().catch(()=>{});if(presenceRecovery===repair)presenceRecovery=null;});
}

function unavailableRoom(id,message){
 if(subscribedRoomId!==id)return;uncertainCommand=null;clearCollection();subscribedRoomId=null;unsubs.forEach(f=>f());unsubs=[];
 if(connection){const old=connection;connection=null;old.remove().catch(()=>{});}
 connectionReady=false;loadingRoom=false;room=null;own={cards:[]};previous=null;screen='home';
 if(localStorage.getItem('kaliRoom')===id)localStorage.removeItem('kaliRoom');
 error=message||'This room is no longer available. It may have been deleted or your access changed. Choose an active room or create a new table.';render();
}
function roomReadError(id,e){if(e.code==='permission-denied'||e.code==='not-found')unavailableRoom(id);else{loadingRoom=false;error='Room connection interrupted. Use Reconnect to restore your seat.';render();}}
async function enter(id){clearCollection();connectionReady=false;loadingRoom=true;room=null;own={cards:[]};subscribedRoomId=id;render();unsubs.forEach(f=>f());unsubs=[];if(connection){const old=connection;connection=null;old.remove().catch(()=>{});}screen='room';records=[];historyMore=true;previous=null;selected=null;scoreOpen=false;
 unsubs.push(db.doc('onlineRooms/'+id).onSnapshot(s=>{if(subscribedRoomId!==id)return;if(!s.metadata.hasPendingWrites&&!s.metadata.isFromCache&&s.exists)speedSnapshot(id,s.data().revision);if(!s.exists){unavailableRoom(id);return;}loadingRoom=false;const next=s.data();if(previous?.hand?.id!==next.hand?.id)selected=null;if(previous&&previous.id===next.id){
 if(previous.hand?.turnGeneration!==next.hand?.turnGeneration)selected=null;
 if(!previous.paused&&next.paused&&R.active(next)){screen='room';scoreOpen=false;historyOpen=false;}
 if(previous.hand?.id!==next.hand?.id){screen='room';scoreOpen=false;historyOpen=false;clearCollection();motionQueue.push('deal');playSound('deal');}
 else if(next.hand&&next.hand.tricks.length>previous.hand.tricks.length)collectTrick(next.hand.tricks.at(-1));
 else if(next.hand?.phase==='playing'&&Object.values(previous.hand?.counts||{}).reduce((a,b)=>a+b,0)>Object.values(next.hand.counts).reduce((a,b)=>a+b,0)){motionQueue.push('card');playSound('card');}
 if(!previous.hand?.trump&&next.hand?.trump){motionQueue.push('trump');playSound('trump');}
 if(!previous.hand?.revealed&&next.hand?.revealed){motionQueue.push('reveal');playSound('reveal');}
}room=next;previous=next;error='';if(!seatConnected())presenceRecovery?.();render();},e=>roomReadError(id,e)));
 unsubs.push(db.doc('onlineRooms/'+id+'/private/'+uid()).onSnapshot(s=>{if(subscribedRoomId!==id)return;own=s.exists?s.data():{cards:[]};render();},e=>roomReadError(id,e)));
 unsubs.push(db.collection('onlineRooms/'+id+'/hands').orderBy('handNumber','desc').limit(25).onSnapshot(s=>{if(subscribedRoomId!==id)return;const combined=new Map(records.map(r=>[r.handId,r]));for(const d of s.docs)combined.set(d.id,d.data());records=[...combined.values()].sort((a,b)=>b.handNumber-a.handNumber);if(s.size<25)historyMore=false;if(historyOpen)render();}));
 await attachPresence(id);localStorage.setItem('kaliRoom',id);
}
function bidIntent(form){return form.dataset.hand+':'+form.dataset.generation+':'+form.dataset.baseBid+':'+form.elements.bid.value;}
root.addEventListener('pointerdown',e=>{const button=e.target.closest('#bid button.gold');if(button&&!button.disabled)button.form._bidIntent=bidIntent(button.form);},{passive:true});
root.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.closest('#bid')){const form=e.target.closest('#bid');form._bidIntent=bidIntent(form);}});
root.addEventListener('pointercancel',()=>{const form=document.getElementById('bid');if(form)delete form._bidIntent;},{passive:true});
root.addEventListener('submit',async e=>{e.preventDefault();if(mutationBlocked())return;const f=e.target,v=Object.fromEntries(new FormData(f));try{
 if(f.id==='join'){busy=true;disableControls();render();if(!user)await auth.signInAnonymously();localStorage.setItem('kaliPlayerId',v.playerId);busy=true;render();const r=await api({code:v.code,commandId:crypto.randomUUID(),action:{type:'join',playerId:v.playerId}});await enter(r.roomId);}
 else if(f.id==='login')await auth.signInWithEmailAndPassword(v.email,v.password);
 else if(f.id==='create'){busy=true;render();const r=await api({operation:'create',sessionName:v.sessionName,playerId:v.playerId,mode:Number(v.mode),config:{sixSuits:[v.six1,v.six2],extraThree:v.extraThree}});await enter(r.roomId);}
 else if(f.id==='register'){const r=await api({operation:'register',name:v.name});notice('Player registered: '+v.name);await loadProfiles();}
 else if(f.id==='bid'){
 const h=room?.hand,value=Number(v.bid);
 const intent=f._bidIntent;delete f._bidIntent;
 if(intent&&intent!==bidIntent(f)){notice('Bidding changed. Review the current bid before submitting.');render();return;}
 if(!h||h.phase!=='auction'||h.turn!==uid()||f.dataset.hand!==h.id||Number(f.dataset.generation)!==h.turnGeneration||Number(f.dataset.baseBid)!==h.bid){notice('Bidding changed. Review the current bid before submitting.');render();return;}
 if(!Number.isInteger(value)||value<=h.bid||value>250||value%5!==0){notice('Choose a bid from '+(h.bid+5)+' to 250 in steps of 5.');render();return;}
 await command({type:'bid',bid:value});
 }
 else if(f.id==='partners')await command({type:'partners',...v});
 else if(f.id==='swap')await command({type:'swap',...v});
 else if(f.id==='deck-config')await command({type:'config',config:{sixSuits:room.mode===4?[v.six1,v.six2]:['C','D'],extraThree:v.extraThree}});
 else if(f.id==='reserve')await command({type:'reserve',playerId:v.playerId});
 else if(f.classList.contains('approve'))await command({type:'approve',target:f.dataset.target,playerId:v.playerId});
 else if(f.classList.contains('assign'))await command({type:'seat',target:f.dataset.target,seat:Number(v.seat)});
 }catch(err){notice(err.message);}finally{busy=false;render();}});
root.addEventListener('change',e=>{if(e.target.matches('#bid select'))updateBidControls();});
root.addEventListener('click',async e=>{const target=e.target.closest('[data-action]');if(!target||target.disabled)return;const [action,...tail]=target.dataset.action.split(':'),arg=tail.join(':');try{
 if(action==='diagnostics'){await showSpeed();}
 else if(action==='retry-move'){if(uncertainCommand&&!busy&&room?.id===uncertainCommand.roomId)await submitMove(uncertainCommand);}
 else if(action==='reconnect'){await reconnectSeat();}
 else if(action==='resume'){if(!seatConnected())await reconnectSeat();if(seatConnected())await command({type:'resume'});}
 else if(action==='bid-max'){const select=root.querySelector('#bid select');if(select){select.value='250';updateBidControls();}}
 else if(action==='bid-up'||action==='bid-down'){const select=root.querySelector('#bid select');if(select){select.selectedIndex=Math.max(0,Math.min(select.options.length-1,select.selectedIndex+(action==='bid-up'?1:-1)));select.dispatchEvent(new Event('change',{bubbles:true}));}}
 else if(action==='sound'){soundEnabled=!soundEnabled;localStorage.setItem('kaliSound',soundEnabled);if(soundEnabled){unlockAudio();playSound('turn');}render();}
 else if(action==='motion'){reduced=!reduced;if(reduced)clearCollection();localStorage.setItem('kaliReducedMotion',reduced);render();}
 else if(action==='room')await enter(arg);
 else if(action==='home'){leaveRoomView();}
 else if(action==='leave'){if(await command({type:'leave'}))leaveRoomView();}
 else if(action==='share'){if(location.hostname==='appassets.androidplatform.net'){location.href='https://appassets.androidplatform.net/assets/kali/share?code='+encodeURIComponent(room.code);return;}const url=new URL(location.hostname==='appassets.androidplatform.net'?KALI_PUBLIC_URL:'index.html',location.href);url.hash='join='+room.code;if(navigator.share)await navigator.share({title:'3 Patti PRO · Join my table',text:'Room '+room.code,url:url.href});else if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(url.href);notice('Invite copied');}else await gameDialog({title:'Room invitation',message:'Copy this link to invite a player.',input:{label:'Invite link',value:url.href,readOnly:true,maxLength:500},choices:[{value:'cancel',label:'Close'}]});}
 else if(action==='card'){selected=arg;render();}
 else if(action==='cancel-card'){selected=null;render();}
 else if(action==='confirm-card'){const c=selected;selected=null;await command({type:'play',card:c});}
 else if(action==='pass')await command({type:'bid',pass:true});
 else if(action==='trump')await command({type:'trump',suit:arg});
 else if(action==='confirm-profile')await command({type:'join',playerId:room.members[uid()].requestedPlayerId});
 else if(action==='claim-seat')await command({type:'claimSeat',seat:Number(arg)});
 else if(action==='bot')await command({type:'bot',seat:Number(arg),difficulty:document.getElementById('difficulty')?.value||'normal'});
 else if(['unseat','sitout','remove'].includes(action))await command({type:action,target:arg});
 else if(action==='close-panel'){scoreOpen=false;historyOpen=false;screen='room';render();}
 else if(action==='scores'){scoreOpen=!scoreOpen;historyOpen=false;screen='room';render();}
 else if(action==='older-history'){const page=await db.collection('onlineRooms/'+room.id+'/hands').orderBy('handNumber','desc').startAfter(records.at(-1).handNumber).limit(25).get();records.push(...page.docs.map(d=>d.data()));historyMore=page.size===25;render();}
 else if(action==='history'){historyOpen=!historyOpen;scoreOpen=false;screen='room';render();}
 else if(action==='manage'){screen=screen==='manage'?'room':'manage';scoreOpen=false;historyOpen=false;render();}
 else if(action==='void-replace'){if(await askConfirm('Void hand & replace player?','No points will be awarded for this unfinished hand. Completed hands and scores stay saved.','Void hand & choose replacement')){if(await command({type:'void'})){screen='manage';scoreOpen=false;historyOpen=false;render();}}}
 else if(action==='replace-bot'){if(await askConfirm('Replace with computer?','Replace '+name(arg)+' for the next hand. Their previous scores stay saved. The computer starts with its own score.','Replace with computer'))await command({type:'replaceBot',target:arg,difficulty:document.getElementById('difficulty')?.value||'normal'});}
 else if(action==='void'){
if(await askConfirm('Void unfinished hand?','No points from this unfinished hand will be awarded. Completed hands stay saved.','Void hand'))await command({type:'void'});}
 else if(action==='rename-session'){const value=await gameDialog({title:'Rename session',message:'Choose the name shown in your session history.',input:{label:'Session name',value:room.sessionName||'Online · '+room.code},choices:[{value:'confirm',label:'Save name',style:'gold'},{value:'cancel',label:'Cancel'}]});if(value!==null){await api({operation:'sessionHistory',sessionId:room.id,action:'rename',name:value,expectedName:room.sessionName||'Online · '+room.code,commandId:crypto.randomUUID()});notice('Session name updated');}}
 else if(action==='stop'){
 const roomId=room.id,handId=room.hand?.id;
 const answer=await gameDialog({title:'Stop session?',message:R.active(room)?'Choose what happens to the unfinished hand. All completed hands and scores stay saved.':'Save final standings and close this session.',choices:R.active(room)?[{value:'finish',label:'Finish hand & stop',description:'Keep playing this hand, save its points, then end the session.',style:'gold'},{value:'void',label:'Void hand & stop',description:'Discard only this unfinished hand. No points for this hand.',style:'danger'},{value:'cancel',label:'Keep playing'}]:[{value:'stop',label:'Stop session',style:'danger'},{value:'cancel',label:'Keep playing'}]});
 if(answer){if(!room||room.id!==roomId||room.hand?.id!==handId){notice('The table changed. Review the current session before stopping.');return;}if(room.status==='stopped'){notice('Session already stopped.');return;}await command({type:'stop',...(answer==='finish'?{finish:true}:answer==='void'?{void:true}:{})});}

 }else if(['ready','pause','resume'].includes(action))await command({type:action});
 }catch(err){if(err.name!=='AbortError')notice(err.message);}});
async function loadProfiles(){profiles=(await db.collection('players').get()).docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(a.name).localeCompare(String(b.name)));render();}
let membershipUnsub=null;
auth.onAuthStateChanged(async current=>{if(user&&user.uid!==current?.uid){uncertainCommand=null;speedRows.length=0;speedSnapshots.clear();speedPending.clear();clearCollection();unsubs.forEach(f=>f());unsubs=[];room=null;own={cards:[]};memberships=[];subscribedRoomId=null;loadingRoom=false;if(connection){connection.remove().catch(()=>{});connection=null;}presence.goOffline();presence.goOnline();}user=current;admin=false;if(membershipUnsub)membershipUnsub();try{if(user){const token=await user.getIdTokenResult();const role=await db.doc('admins/'+user.uid).get();admin=token.claims.admin===true||role.exists;membershipUnsub=db.collection('onlineMemberships/'+user.uid+'/rooms').onSnapshot(s=>{memberships=s.docs.map(d=>d.data());if(!room)render();});}await loadProfiles();if(user)await api({operation:'clock'});}catch(e){error=e.message;}render();});
window.kaliReconnect=()=>{presenceRecovery?.();render();};
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearCollection();speedFrame();}else window.kaliReconnect();});
window.addEventListener('online',window.kaliReconnect);window.addEventListener('offline',()=>{connectionReady=false;render();});
// Native injects only an expiring one-use exchange after this document has loaded.
window.kaliAcceptExchange=async exchange=>{try{const result=await api({exchange},'kaliConsumeExchange');await auth.signInWithCustomToken(result.token);window.KALI_NATIVE_PENDING=false;render();return auth.currentUser.uid;}catch(e){notice(e.message);throw e;}};
render();

window.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.querySelector('.table-drawer')){scoreOpen=false;historyOpen=false;screen='room';render();}});
