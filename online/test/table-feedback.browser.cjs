'use strict';
const {chromium}=require('playwright'),A=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),R=require('../shared/engine'),B=require('../shared/bot');
const checks=[],errors=[],artifacts=process.env.KALI_ARTIFACT_DIR||path.resolve('test-results/kali');fs.mkdirSync(artifacts,{recursive:true});
function fixture(mode){let n=100,now=1000,r=R.create({id:'visual_fixture',code:'ABCDEFGH',uid:'human',name:'Hozefa',playerId:'human_profile',sessionName:'Family table',mode},now);const send=(uid,a)=>r=R.command(r,uid,a,++now,max=>n++%max);for(let seat=2;seat<=mode;seat++)send('human',{type:'bot',seat,botId:'bot_'+seat});send('human',{type:'ready'});while(r.hand.phase!=='playing')send(r.hand.turn,B.decide(R.publicState(r),r.hand.turn,R.privateState(r,r.hand.turn).cards));return {get room(){return r;},send};}
async function inject(p,r,local='human'){await p.evaluate(({pub,cards,local})=>{clearCollection();user={uid:local,getIdToken:async()=> 'emulator-visual-only'};room=pub;previous=pub;own=cards;connectionReady=true;busy=false;reduced=false;error='';renderNow();},{pub:R.publicState(r),cards:R.privateState(r,local),local});}
(async()=>{const browser=await chromium.launch({headless:true,args:['--no-sandbox']});try{
 const p=await browser.newPage({viewport:{width:360,height:800}});p.on('pageerror',e=>errors.push(e.message));await p.goto('http://127.0.0.1:8765/online/index.html?emulator=1');await p.waitForFunction(()=>typeof collectTrick==='function'&&!!document.getElementById('join'));await p.evaluate(async()=>{await loadProfiles();});
 await p.evaluate(()=>{room=null;memberships=[{roomId:'live',sessionName:'ACTIVE_FIXTURE',status:'playing'},{roomId:'old',sessionName:'CLOSED_FIXTURE',status:'stopped'},{roomId:'left',sessionName:'REMOVED_FIXTURE',status:'Removed'}];renderNow();});A.equal(await p.locator('[data-action="room:live"]').count(),1);A.equal(await p.locator('[data-action="room:old"]').count(),0);A.equal(await p.locator('[data-action="room:left"]').count(),0);checks.push('closed/removed rooms are absent from active rooms; outer History remains the completed-session destination');
 for(const mode of [4,6]){
  const f=fixture(mode);await inject(p,f.room);
  A.equal(await p.locator('.partner-status.secret').count(),1);A.equal(f.room.hand.revealed,false);A.equal(R.publicState(f.room).hand.secret,null);
  for(const width of [320,360,390,1080]){await p.setViewportSize({width,height:900});await p.evaluate(()=>renderNow());const dimensions=await p.evaluate(()=>{const cards=[...document.querySelectorAll('.hand-card')].map(c=>{const r=c.getBoundingClientRect();return {x:r.x,right:r.right};});return {width:innerWidth,scroll:document.documentElement.scrollWidth,cards};});A(dimensions.scroll<=dimensions.width);A(dimensions.cards.every((c,i)=>!i||c.x>=dimensions.cards[i-1].right+1));}
  await p.setViewportSize({width:360,height:800});await p.evaluate(()=>{const h=document.querySelector('.my-hand');h.scrollLeft=120;renderNow();});A(await p.locator('.my-hand').evaluate(h=>h.scrollLeft>0));
  const secret=f.room.hand.secret;const revealed=R.publicState(f.room);revealed.hand.revealed=true;revealed.hand.secret=secret;revealed.hand.partners=f.room.hand.partners;
  await p.evaluate(pub=>{room=pub;renderNow();},revealed);A((await p.locator('.partner-status.revealed').textContent()).includes(f.room.members[secret].name));A(await p.evaluate(()=>document.querySelector('.partner-status').getBoundingClientRect().bottom<=document.querySelector('.felt').getBoundingClientRect().top));
  await p.screenshot({path:artifacts+'/table-feedback-'+mode+'.png',fullPage:true});checks.push(mode+'-seat layouts: no overlapping hand cards/viewport overflow, swipe position survives renders, partner reveal stays above table');
  // Resolve one actual legal trick through the engine, then exercise each visual viewpoint.
  const before=JSON.parse(JSON.stringify(f.room));for(let i=0;i<mode;i++){const r=f.room,h=r.hand;f.send(h.turn,{type:'play',card:R.legal(h.hands[h.turn],h.trick)[0]});}const after=JSON.parse(JSON.stringify(f.room)),trick=after.hand.tricks.at(-1);
  for(const local of [trick.winner,after.hand.seatMap.find(s=>s.uid!==trick.winner).uid]){
   await inject(p,before,local);
   await p.evaluate(({pub,cards,trick})=>{collectTrick(trick);room=pub;own=cards;renderNow();},{pub:R.publicState(after),cards:R.privateState(after,local),trick});
   A.equal(await p.locator('.trick-flight[data-winner="'+trick.winner+'"]').count(),1);A((await p.locator('.trick-announcement').textContent()).includes(after.members[trick.winner].name));A.equal(await p.locator('.centre-trick .played-card').count(),0);
   const trajectory=await p.evaluate(winner=>{const flight=document.querySelector('.trick-flight'),seat=document.querySelector('.table-seat[data-player="'+winner+'"]'),animation=flight.getAnimations()[0];animation.pause();animation.currentTime=800;const f=flight.getBoundingClientRect(),s=seat.getBoundingClientRect();return {dx:Math.abs(f.x+f.width/2-s.x-s.width/2),dy:Math.abs(f.y+f.height/2-s.y-s.height/2)};},trick.winner);A(trajectory.dx<2,JSON.stringify(trajectory));A(trajectory.dy<2,JSON.stringify(trajectory));
   await p.locator('.trick-flight').waitFor({state:'detached'});A.equal(await p.locator('.centre-trick .played-card').count(),0);A((await p.locator('.last-trick').textContent()).includes(after.members[trick.winner].name));
  }
  await inject(p,after);A.equal(await p.locator('.trick-flight').count(),0);A.equal(await p.locator('.centre-trick .played-card').count(),0);
  checks.push(mode+'-seat completed trick flies to the authoritative winner from own/opponent viewpoints, clears centre, and is not replayed on restore');
 }
 A.deepEqual(errors,[]);console.log(JSON.stringify({checks,errors}));
 }finally{fs.writeFileSync(artifacts+'/table-feedback-report.json',JSON.stringify({checks,errors},null,2));await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
