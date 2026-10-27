'use strict';
const {test,before,after}=require('node:test'),A=require('node:assert/strict'),fs=require('node:fs');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing');
global.firebase=require('firebase/compat/app');require('firebase/compat/firestore');
const Sync=require('../../tracker-sync');let env;
before(async()=>{A.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^(127\.0\.0\.1|localhost):8080$/);env=await initializeTestEnvironment({projectId:'demo-three-patti',firestore:{host:'127.0.0.1',port:8080,rules:fs.readFileSync('firestore.rules','utf8')}});});
after(async()=>env?.cleanup());
test('two simultaneous manual session starts cannot both commit',{timeout:60000},async()=>{
 await env.clearFirestore();await env.withSecurityRulesDisabled(c=>c.firestore().doc('trackerSync/state').set({mode:'incremental',enforced:true,epoch:1,revision:0,eventId:'seed',paths:[]}));
 const admins=['one','two'].map(uid=>env.authenticatedContext(uid,{admin:true}).firestore());
 const outcomes=await Promise.allSettled(admins.map((db,i)=>Sync.commit(db,[{type:'set',ref:db.doc('sessions/race_'+i),data:{sessionName:'Race '+i,startTime:new Date(),endTime:null}}],new Map(),undefined,process.env.KALI_BASELINE==='true'?undefined:{manualStart:true})));
 const rows=await admins[0].collection('sessions').get({source:'server'});console.log('MANUAL_START_RACE',JSON.stringify({committed:outcomes.filter(r=>r.status==='fulfilled').length,activeSessions:rows.size,baseline:process.env.KALI_BASELINE==='true'}));
 A.equal(rows.size,process.env.KALI_BASELINE==='true'?2:1);
});
async function guarded(){await env.clearFirestore();await env.withSecurityRulesDisabled(async c=>{const d=c.firestore();await d.doc('trackerSync/state').set({mode:'incremental',enforced:true,epoch:1,revision:0,eventId:'seed',paths:[]});await d.doc('meta/manualSession').set({sessionId:null});});return env.authenticatedContext('guard-admin',{admin:true}).firestore();}
const start=(db,id)=>Sync.commit(db,[{type:'set',ref:db.doc('sessions/'+id),data:{sessionName:id,startTime:new Date(),endTime:null}}],new Map(),undefined,{manualStart:true});
async function raw(db,event,edits){const h=(await db.doc('trackerSync/state').get()).data(),b=db.batch(),paths=edits.filter(e=>e.path!=='meta/manualSession').map(e=>e.path).sort();for(const e of edits)if(e.remove)b.delete(db.doc(e.path));else b.set(db.doc(e.path),e.data);b.set(db.doc('trackerChanges/'+event),{epoch:h.epoch,revision:h.revision+1,paths});b.set(db.doc('trackerSync/state'),{...h,revision:h.revision+1,eventId:event,paths});return b.commit();}
test('six concurrent updated admins produce exactly one active manual session under the server guard',{timeout:60000},async()=>{const db=await guarded(),admins=Array.from({length:6},(_,i)=>env.authenticatedContext('guard_'+i,{admin:true}).firestore());const results=await Promise.allSettled(admins.map((d,i)=>start(d,'six_'+i)));A.equal(results.filter(r=>r.status==='fulfilled').length,1);const sessions=await db.collection('sessions').get();A.equal(sessions.size,1);A.equal((await db.doc('meta/manualSession').get()).data().sessionId,sessions.docs[0].id);});
test('rules reject bypassed guards, illegal pointer switches and old bulk writers before any deletion',{timeout:60000},async()=>{const db=await guarded();await start(db,'one');await Sync.commit(db,[{type:'set',ref:db.doc('rounds/kept'),data:{scoreChanges:{a:360}}}]);
 await assertFails(raw(db,'web2_forged',[{path:'sessions/two',data:{endTime:null}},{path:'meta/manualSession',data:{sessionId:'two'}}]));
 await assertFails(raw(db,'web2_missing_pointer',[{path:'sessions/two',data:{endTime:null}}]));
 await assertFails(raw(db,'native_old_client',[{path:'rounds/kept',remove:true}]));A.equal((await db.doc('rounds/kept').get()).data().scoreChanges.a,360);A.equal((await db.collection('sessions').get()).size,1);
 await assertFails(db.doc('meta/manualSession').set({sessionId:null}));
});
test('normal rounds use authoritative current session; historical restores retain original session IDs',{timeout:60000},async()=>{const db=await guarded();await start(db,'one');await Sync.commit(db,[{type:'set',ref:db.doc('rounds/new'),data:{source:'manual',sessionId:'stale',scoreChanges:{a:360}}}],new Map(),undefined,{manualRound:true,eventId:'web2_round_new'});A.equal((await db.doc('rounds/new').get()).data().sessionId,'one');
 await assertFails(raw(db,'web2_round_forged',[{path:'rounds/wrong',data:{source:'manual',sessionId:'stale',scoreChanges:{a:999}}}]));
 await Sync.commit(db,[{type:'set',ref:db.doc('rounds/historical'),data:{source:'manual',sessionId:'archived',scoreChanges:{a:-155}}}],new Map());A.equal((await db.doc('rounds/historical').get()).data().sessionId,'archived');
 const old=(await db.doc('sessions/one').get()).data();await Sync.commit(db,[{type:'update',ref:db.doc('sessions/one'),data:{endTime:new Date()}},{type:'set',ref:db.doc('sessions/two'),data:{endTime:null,sessionName:'two'}}],new Map([['sessions/one',old]]));A.equal((await db.doc('meta/manualSession').get()).data().sessionId,'two');
});
test('round-save versus session-stop race attaches according to committed journal order',{timeout:60000},async()=>{const db=await guarded();await start(db,'one');const old=(await db.doc('sessions/one').get()).data();await Promise.all([Sync.commit(db,[{type:'update',ref:db.doc('sessions/one'),data:{endTime:new Date()}}],new Map([['sessions/one',old]])),Sync.commit(db,[{type:'set',ref:db.doc('rounds/race'),data:{source:'manual',sessionId:'stale',scoreChanges:{a:360}}}],new Map(),undefined,{manualRound:true,eventId:'web2_round_race'})]);const events=(await db.collection('trackerChanges').get()).docs.map(d=>d.data()),r=events.find(e=>e.paths.includes('rounds/race')),stop=events.find(e=>e.paths.includes('sessions/one')&&e.revision>1);A.equal((await db.doc('rounds/race').get()).data().sessionId,r.revision<stop.revision?'one':null);A.equal((await db.doc('meta/manualSession').get()).data().sessionId,null);});
test('stable web receipt survives lost acknowledgement, reload and later deletion without duplicate scores',{timeout:60000},async()=>{
 await env.clearFirestore();await env.withSecurityRulesDisabled(c=>c.firestore().doc('trackerSync/state').set({mode:'incremental',enforced:true,epoch:1,revision:0,eventId:'seed',paths:[]}));
 const db=env.authenticatedContext('writer',{admin:true}).firestore(),ref=db.doc('rounds/stable'),data={source:'manual',type:'hukum',scoreChanges:{a:360,b:180},timestamp:new Date(1)},opts={eventId:'web2_round_stable'};
 await Sync.commit(db,[{type:'set',ref,data}],new Map(),undefined,opts);const head=(await db.doc('trackerSync/state').get({source:'server'})).data();
 await Sync.commit(db,[{type:'set',ref,data}],new Map([['rounds/stable',data]]),head.revision,opts);A.equal((await db.collection('rounds').get({source:'server'})).size,1);A.equal((await db.doc('trackerSync/state').get({source:'server'})).data().revision,head.revision);
 await A.rejects(Sync.commit(db,[{type:'set',ref:db.doc('rounds/different'),data}],new Map(),undefined,opts),/different command/);
 await Sync.commit(db,[{type:'delete',ref}],new Map([['rounds/stable',data]]));await Sync.commit(db,[{type:'set',ref,data}],new Map(),undefined,opts);A.equal((await ref.get({source:'server'})).exists,false);A.equal((await db.collection('rounds').get({source:'server'})).size,0);
});
test('guard rollout is read-only by default, preserves old writers before opt-in and can roll back without data loss',{timeout:60000},async()=>{
 await env.clearFirestore();await env.withSecurityRulesDisabled(c=>c.firestore().doc('trackerSync/state').set({mode:'incremental',enforced:true,epoch:1,revision:0,eventId:'seed',paths:[]}));
 const client=env.authenticatedContext('old-admin',{admin:true}).firestore();await raw(client,'native_legacy',[{path:'sessions/old',data:{startTime:new Date(),endTime:null}}]);
 const {Firestore}=await import('../../backend/free/firestore.mjs'),{cutover}=await import('../../backend/free/manual-session-cutover.mjs'),db=new Firestore('demo-three-patti',async()=>'owner',undefined,{origin:'http://127.0.0.1:8080'});
 const before=await db.get('trackerSync/state');const dry=await cutover(db);A.equal(dry.proposed.sessionId,'old');A.equal(await db.get('meta/manualSession'),null);await A.rejects(cutover(db,{apply:true}),/confirmed updated/);
 await cutover(db,{apply:true,editorsUpdated:true,rulesVerified:true});A.equal((await db.get('meta/manualSession')).sessionId,'old');A.deepEqual(await db.get('trackerSync/state'),before);
 await assertFails(raw(client,'native_legacy_delete',[{path:'sessions/old',remove:true}]));await cutover(db,{apply:true,disable:true});A.equal(await db.get('meta/manualSession'),null);A((await db.get('sessions/old')));A.deepEqual(await db.get('trackerSync/state'),before);
});
