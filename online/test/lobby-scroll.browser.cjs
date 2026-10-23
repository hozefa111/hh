'use strict';
const {chromium}=require('playwright'),R=require('../shared/engine'),A=require('node:assert/strict'),fs=require('node:fs');
(async()=>{const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const report={checks:[],errors:[],screens:[]};try{
 for(const [width,height]of [[320,568],[390,844],[844,390]]){
  const page=await browser.newPage({viewport:{width,height},isMobile:true,hasTouch:true});page.on('pageerror',e=>report.errors.push(e.message));await page.goto((process.env.KALI_TEST_BASE||'http://127.0.0.1:8765')+'/online/index.html?emulator=1');await page.waitForFunction(()=>typeof renderNow==='function');await page.waitForTimeout(600);
  for(const mode of [4,6]){
   const pub=R.publicState(R.create({id:'touch_'+mode,code:'ABCDEFGH',uid:'owner',playerId:'a',name:'Owner',mode},1000));A(!Object.hasOwn(pub,'hand'));
   const result=await page.evaluate(pub=>{user={uid:'owner',getIdToken:async()=>''};room=pub;own={cards:[]};connectionReady=true;busy=false;error='';renderNow();const seats=document.querySelector('.lobby-seats'),ready=document.querySelector('[data-action=ready]'),original=window.scrollTo;let calls=0;window.scrollTo=function(){calls++;return original.apply(this,arguments)};
    try{for(let i=0;i<25;i++){room.revision++;room.sessionName='Lobby '+i;renderNow();if(document.body.classList.contains('live-game')||document.body.classList.contains('bidding'))return {unlocked:false};}return {unlocked:true,calls,sameSeats:seats===document.querySelector('.lobby-seats'),sameReady:ready===document.querySelector('[data-action=ready]'),count:document.querySelectorAll('[data-action=ready]').length,disabled:ready.disabled};}finally{window.scrollTo=original;}
   },pub);A.deepEqual(result,{unlocked:true,calls:0,sameSeats:true,sameReady:true,count:1,disabled:true});
   await page.waitForTimeout(100);A(await page.evaluate(()=>{const r=document.querySelector('.lobby-ready').getBoundingClientRect(),b=document.querySelector('[data-action=ready]').getBoundingClientRect();return r.bottom<=innerHeight+1&&b.top>=0&&b.bottom<=innerHeight+1&&document.documentElement.scrollWidth<=innerWidth+1&&parseFloat(getComputedStyle(document.querySelector('main')).paddingBottom)>=r.height;}));
   report.checks.push(`${width}x${height}, ${mode} seats: missing-hand lobby stays unlocked over25 updates, stable seat/Ready nodes, zero scroll resets, visible single disabled admin action, reserved dock space and no horizontal overflow`);
   // Real touch stream rather than assigning scrollTop to prove gesture scrolling.
   const cdp=await page.context().newCDPSession(page);await page.evaluate(()=>scrollTo(0,0));const from=height*.68,to=height*.25;
   for(let n=0;n<3;n++){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:width*.45,y:from}]});for(let i=1;i<=18;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:width*.45,y:from+(to-from)*i/18}]});await page.waitForTimeout(16);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(120);}
   A(await page.evaluate(()=>scrollY>80));report.checks.push(`${width}x${height}, ${mode} seats: repeated native browser touch drags scroll vertically`);
   A(await page.evaluate(()=>{room.paused=true;renderNow();return document.querySelector('[data-action=ready]').disabled&&!document.body.classList.contains('live-game');}));
   await page.evaluate(()=>{room.paused=false;room.members.owner.connected=false;renderNow();});A(await page.locator('[data-action=ready]').isDisabled());
   await page.evaluate(()=>{room.status='stopped';renderNow();});A.equal(await page.locator('.lobby-ready').count(),0);
  }
  await page.close();
 }
 A.deepEqual(report.errors,[]);fs.mkdirSync('test-results/kali',{recursive:true});fs.writeFileSync('test-results/kali/lobby-scroll-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
