const {test,before,after}=require('node:test'),A=require('node:assert/strict'),fs=require('node:fs');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing');
global.firebase=require('firebase/compat/app');require('firebase/compat/firestore');
const Sync=require('../../tracker-sync');let env,db,plain;
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-three-patti',firestore:{host:'127.0.0.1',port:8080,rules:fs.readFileSync('firestore.rules','utf8')}});db=env.authenticatedContext('journal-admin',{admin:true}).firestore();plain=env.unauthenticatedContext().firestore();});
after(async()=>env?.cleanup());
async function seed(){await env.clearFirestore();await env.withSecurityRulesDisabled(async ctx=>{const d=ctx.firestore();for(let start=0;start<1001;start+=400){const b=d.batch();for(let i=start;i<Math.min(1001,start+400);i++)b.set(d.doc('rounds/r'+String(i).padStart(4,'0')),{scoreChanges:{p:i===0?360:155},timestamp:new Date(1000+i)});await b.commit();}await d.doc('players/p').set({name:'Player'});await d.doc('sessions/s').set({sessionName:'Existing',endTime:new Date(2)});await d.doc('trackerSync/state').set({mode:'incremental',enforced:true,epoch:7,revision:0,eventId:'seed',paths:[]});});}
function meter(base){const counts={queries:0,rows:0,gets:0},wrap=q=>new Proxy(q,{get(t,k){if(k==='get')return async(...args)=>{const s=await t.get(...args);counts.queries++;counts.rows+=s.size;return s;};const v=t[k];return typeof v==='function'?(...args)=>{const r=v.apply(t,args);return r&&typeof r.get==='function'?wrap(r):r;}:v;}});return {counts,db:{collection:p=>wrap(base.collection(p)),doc:p=>{const ref=base.doc(p);return new Proxy(ref,{get(t,k){if(k==='get')return async(...args)=>{counts.gets++;return t.get(...args);};const v=t[k];return typeof v==='function'?v.bind(t):v;}});}}};}
function reader(base=plain,saved=null){let stored=saved,delivered=[];const m=meter(base),c=new Sync.Client(m.db,{load:async()=>stored,save:async s=>{stored=structuredClone(Sync.pack(s));}},{onData:(s,v)=>delivered.push({s,v})});c.running=true;c.generation=1;if(saved){c.rows=new Map(saved.rows);c.revision=saved.revision;c.epoch=saved.epoch;c.integrity=saved.integrity;}return {c,m,delivered,get stored(){return stored;}};}
const total=c=>[...c.rows].filter(([p])=>p.startsWith('rounds/')).reduce((n,[,r])=>n+r.scoreChanges.p,0);
test('measured bootstrap, unchanged reopen and old edit/delete fetch only missing changes',{timeout:90000},async()=>{
 await seed();const a=reader();await a.c.refresh();A.equal(total(a.c),155360);A.equal(a.m.counts.rows,1003);A.equal(a.delivered.length,1);
 const saved={rows:[...a.c.rows],revision:a.c.revision,epoch:a.c.epoch,integrity:a.c.integrity},b=reader(plain,saved);await b.c.refresh();A.equal(b.m.counts.rows,0);A.equal(b.m.counts.gets,1);A.equal(total(b.c),155360);
 await Sync.commit(db,[{type:'update',ref:db.doc('rounds/r0000'),data:{scoreChanges:{p:700}}}]);const start={...b.m.counts};await b.c.refresh();A.equal(total(b.c),155700);A.equal(b.m.counts.rows-start.rows,1);A.equal(b.m.counts.gets-start.gets,3);
 await Sync.commit(db,[{type:'delete',ref:db.doc('rounds/r0000')}]);await b.c.refresh();A.equal(total(b.c),155000);A.equal(b.c.rows.has('rounds/r0000'),false);
 fs.mkdirSync('test-results/kali',{recursive:true});fs.writeFileSync('test-results/kali/automatic-tracker-sync.json',JSON.stringify({scope:'Firestore emulator SDK document deliveries, excludes billed rule evaluation',bootstrapRoundPlayerSessionDocuments:1003,unchangedReopen:{metadataReads:1,ledgerDocuments:0},oldRecordEdit:{journalDocuments:1,metadataAndRecordReads:3},totalBefore:155360,totalAfterEdit:155700,totalAfterDelete:155000},null,2));
});
test('active rules reject old writes, mode changes, forged journal, and guest mutations',{timeout:30000},async()=>{
 await seed();await assertFails(db.doc('rounds/old_client').set({scoreChanges:{p:999}}));await assertFails(db.doc('rounds/r0000').delete());await assertFails(db.doc('trackerSync/state').update({mode:'prepare'}));await assertFails(db.doc('trackerChanges/forged').set({revision:1,epoch:7,paths:['rounds/r0000']}));await assertFails(Sync.commit(plain,[{type:'delete',ref:plain.doc('rounds/r0000')}]));await Sync.commit(db,[{type:'set',ref:db.doc('rounds/new_client'),data:{scoreChanges:{p:155}}}]);
});
test('interrupted local cache commit cannot advance checkpoint or publish partial totals',{timeout:30000},async()=>{
 await seed();let publish=0;const c=new Sync.Client(plain,{load:async()=>null,save:async()=>{throw Error('Interrupted cache transaction');}},{onData:()=>publish++});c.running=true;c.generation=1;await A.rejects(c.run(null,1),/Interrupted/);A.equal(c.revision,-1);A.equal(publish,0);
});
test('stale confirmations and record preconditions preserve newer data',{timeout:30000},async()=>{
 await seed();const r=reader();await r.c.refresh();const before=new Map(r.c.rows);await Sync.commit(db,[{type:'update',ref:db.doc('rounds/r0000'),data:{scoreChanges:{p:888}}}]);await A.rejects(Sync.commit(db,[{type:'delete',ref:db.doc('rounds/r0000')}],before,0),/Scores changed/);A.equal((await db.doc('rounds/r0000').get()).data().scoreChanges.p,888);
});
test('bootstrap reconciles an already-read historical row changed during paging',{timeout:30000},async()=>{
 await seed();let once=false;const base=plain,proxy=new Proxy(base,{get(t,k){if(k==='collection')return name=>{const wrap=q=>new Proxy(q,{get(x,key){if(key==='get')return async(...args)=>{const s=await x.get(...args);if(name==='rounds'&&!once){once=true;await Sync.commit(db,[{type:'update',ref:db.doc('rounds/r0000'),data:{scoreChanges:{p:999}}}]);}return s;};const v=x[key];return typeof v==='function'?(...args)=>{const r=v.apply(x,args);return r&&typeof r.get==='function'?wrap(r):r;}:v;}});return wrap(t.collection(name));};const v=t[k];return typeof v==='function'?v.bind(t):v;}});
 const r=reader(proxy);await r.c.refresh();A.equal(total(r.c),155999);A.equal(r.c.revision,1);A.equal(r.delivered.length,1);
});
test('duplicate notifications and repeated refresh never double credit a record',{timeout:30000},async()=>{
 await seed();const r=reader();await r.c.refresh();await Sync.commit(db,[{type:'update',ref:db.doc('rounds/r0000'),data:{scoreChanges:{p:700}}}]);await Promise.all([r.c.refresh(),r.c.refresh(),r.c.refresh()]);A.equal(total(r.c),155700);await r.c.refresh();A.equal(total(r.c),155700);
});
test('rollback switches readers first and retains enforcement until explicitly relaxed',{timeout:30000},async()=>{
 await seed();await env.withSecurityRulesDisabled(ctx=>ctx.firestore().doc('trackerSync/state').update({mode:'prepare'}));await assertFails(db.doc('rounds/old_client').set({scoreChanges:{p:999}}));await Sync.commit(db,[{type:'update',ref:db.doc('rounds/r0000'),data:{scoreChanges:{p:700}}}]);await env.withSecurityRulesDisabled(ctx=>ctx.firestore().doc('trackerSync/state').update({enforced:false}));await db.doc('rounds/old_client').set({scoreChanges:{p:155}});
});
