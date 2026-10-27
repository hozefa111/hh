'use strict';
const {test}=require('node:test'),A=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8'),code=source.slice(source.indexOf('let webRoundPending='),source.indexOf('\nfunction showRoundSharePrompt('));
function browser(shared={storage:new Map(),records:new Map(),receipts:new Set(),serial:0},lost=true){
 const button={},calls=[],toasts=[];let failAfterCommit=lost;
 const context={console:{error(){}},Map,Date,JSON,Number,navigator:{onLine:true},currentUser:{uid:'admin'},isAdminUser:true,activeViewId:'view-round',trackerRequested:true,trackerPlayersReady:true,trackerRoundReady:true,trackerSessionReady:true,trackerSyncStatus:'current',automaticTracker:{mode:'incremental'},
  sessionStorage:{getItem:k=>shared.storage.get(k)||null,setItem:(k,v)=>shared.storage.set(k,v),removeItem:k=>shared.storage.delete(k)},
  document:{getElementById:()=>button},getActivePlayers:()=>['a','b','c'].map(id=>({id})),getPlayerName:id=>id,calculateScoreChanges:()=>({a:360,b:180,c:0}),safeToDate:v=>v?new Date(v):null,firebase:{firestore:{FieldValue:{serverTimestamp:()=>new Date()}}},
  db:{collection:()=>({doc:()=>({id:'r'+(++shared.serial)})}),doc:path=>({path})},sessionState:{activeSessionId:'session'},roundFormState:{bid:180,hukum:'a',partners:['b'],result:'win',playingIds:['a','b','c']},renderRoundForm(){},showRoundSharePrompt(){},showToast:m=>toasts.push(m),
  trackerCommit:async(ops,options)=>{calls.push({ops,options});if(!shared.receipts.has(options.eventId)){A.equal(shared.records.has(ops[0].ref.path),false);shared.records.set(ops[0].ref.path,ops[0].data);shared.receipts.add(options.eventId);}if(failAfterCommit){failAfterCommit=false;throw Error('Response lost after server commit');}}
 };vm.createContext(context);vm.runInContext(code,context);return {context,shared,calls,toasts};
}
test('lost web save acknowledgement reuses original document and journal receipt, including reload',async()=>{
 const f=browser();await f.context.saveRoundData();A.equal(f.shared.records.size,1);A.equal(f.shared.storage.size,1);A.equal(f.context.roundFormState.bid,180);A.equal(f.context.roundFormState.hukum,'a');const original=f.calls[0];
 const reopened=browser(f.shared,false);await reopened.context.saveRoundData();A.equal(f.shared.records.size,1);A.equal(f.shared.receipts.size,1);A.equal(f.shared.storage.size,0);A.equal(reopened.calls[0].ops[0].ref.path,original.ops[0].ref.path);A.equal(reopened.calls[0].options.eventId,original.options.eventId);A.equal(reopened.context.roundFormState.bid,155);A.equal(reopened.context.roundFormState.hukum,null);A.deepEqual([...reopened.context.roundFormState.playingIds],['a','b','c']);
});
test('rapid duplicate taps submit one command and the next intentional round gets a new ID',async()=>{
 const f=browser(undefined,false);let release;const original=f.context.trackerCommit;f.context.trackerCommit=async(...args)=>{await new Promise(r=>release=r);return original(...args);};const first=f.context.saveRoundData();await f.context.saveRoundData();release();await first;A.equal(f.calls.length,1);A.equal(f.shared.records.size,1);
 f.context.trackerCommit=original;Object.assign(f.context.roundFormState,{bid:180,hukum:'a',partners:['b'],result:'win'});await f.context.saveRoundData();A.equal(f.shared.records.size,2);A.notEqual(f.calls[0].ops[0].ref.path,f.calls[1].ops[0].ref.path);
});
test('offline/incomplete state and unavailable intent storage never submit a write',async()=>{
 const f=browser(undefined,false);f.context.trackerRoundReady=false;await f.context.saveRoundData();A.equal(f.calls.length,0);A.equal(f.shared.storage.size,0);f.context.trackerRoundReady=true;f.context.sessionStorage.setItem=()=>{throw Error('Storage full');};await f.context.saveRoundData();A.equal(f.calls.length,0);A.equal(f.shared.records.size,0);
});
test('corrupt intent is retained and another account cannot claim it',async()=>{
 const f=browser(undefined,false);f.shared.storage.set('3patti-unconfirmed-round:admin','corrupt');await f.context.saveRoundData();A.equal(f.calls.length,0);A.equal(f.shared.storage.get('3patti-unconfirmed-round:admin'),'corrupt');f.context.currentUser={uid:'other'};A.equal(f.context.pendingWebRound(),null);A.equal(f.shared.storage.size,1);
});
