'use strict';
const {test}=require('node:test'),A=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Session=require('../shared/session');
const source=fs.readFileSync('app.js','utf8');
function functionCode(name){const start=source.indexOf('function '+name+'('),end=source.indexOf('\nfunction ',start+1);return source.slice(start,end);}
function context(){const c={players:[],rounds:[],sessions:[],trackerCompleteLedger:true,PattiSession:Session,safeToDate:v=>v?new Date(v):null,getPlayerName:id=>c.players.find(p=>p.id===id)?.name||'Unknown'};vm.createContext(c);vm.runInContext(functionCode('computeAllPlayerStats')+functionCode('getWinningStreak')+source.slice(source.indexOf('function computeManualSessionSummary('),source.indexOf('window.endSession =')),c);return c;}
test('manual summary formulas still match the existing 64 web/native parity vectors',()=>{
 const vectors=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'fixtures/web-session-vectors.json'),'utf8')).vectors;
 for(const v of vectors){const c=context();c.players=v.players;const actual=c.computeManualSessionSummary(new Date(0),new Date(1),'Name',v.rounds);const {sessionName,startTime,endTime,duration,...stats}=JSON.parse(JSON.stringify(actual));A.deepEqual(stats,v.expected,v.name);}
});
test('deleted manual rounds correct saved views; online summaries and incomplete ledgers remain authoritative',()=>{
 const c=context();c.players=['a','b','c'].map(id=>({id,name:id}));const r={id:'round',sessionId:'s',source:'manual',type:'hukum',bid:180,hukumId:'a',partnerIds:['b'],nonPartnerIds:['c'],playerIds:['a','b','c'],result:'win',timestamp:new Date(1),scoreChanges:{a:360,b:180,c:0}},s={id:'s',sessionName:'Old',startTime:new Date(0),endTime:new Date(10),totalRounds:99,leaderboard:[],mvp:{name:'old',score:999}};c.rounds=[r];c.sessions=[s];const corrected=c.correctedManualSession(s);A.equal(corrected.totalRounds,1);A.equal(corrected.mvp.name,'a');A.equal(s.totalRounds,99);c.rounds=[];A.equal(c.correctedManualSession(s).totalRounds,0);A.equal(c.correctedManualSession(s).mvp,null);const online={...s,source:'online'};A.equal(c.correctedManualSession(online),online);c.trackerCompleteLedger=false;A.equal(c.correctedManualSession(s),s);
});
test('legacy overlap, explicit session identity and duplicate record handling match native session ranks',()=>{
 const s=[{id:'a',startTime:new Date(0),endTime:new Date(10)},{id:'b',startTime:new Date(5),endTime:new Date(20)}],r={id:'one',timestamp:new Date(6)};A.equal(Session.roundsFor([r],s,'a').length,0);A.equal(Session.roundsFor([{...r,sessionId:'a'},{...r,sessionId:'a'}],s,'a').length,1);A.equal(Session.roundsFor([{...r,source:'online',sessionId:'a'}],s,'a').length,0);
});
test('a just-completed summary without a saved document ID retains its calculated results',()=>{
 const c=context(),summary={totalRounds:3,mvp:{name:'Winner',score:310},startTime:new Date(0),endTime:new Date(10)};A.equal(c.correctedManualSession(summary),summary);
});
