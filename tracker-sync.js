/* Public tracker changes only; no live rooms or private cards. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TrackerSync=api;})(typeof globalThis==='undefined'?this:globalThis,function(){
'use strict';
const collections=['players','rounds','sessions'];
// Incremental readers require enforced journaling; otherwise use verified full sync.
const readerHead=h=>h.mode==='incremental'&&h.enforced!==true?{...h,mode:'prepare'}:h;
const validPath=p=>/^(players|rounds|sessions)\/[a-zA-Z0-9_-]{1,240}$/.test(p);
function pack(v){if(v===null||typeof v!=='object')return v;if(v instanceof Date)return {__trackerDate:v.toISOString()};if(typeof v.toDate==='function'&&Number.isInteger(v.seconds))return {__trackerTimestamp:[v.seconds,v.nanoseconds]};if(Array.isArray(v))return v.map(pack);if(v.firestore&&typeof v.path==='string')return {__trackerRef:v.path};return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,pack(x)]));}
function unpack(v,db){if(v===null||typeof v!=='object')return v;if(v.__trackerTimestamp)return new firebase.firestore.Timestamp(...v.__trackerTimestamp);if(v.__trackerDate)return new Date(v.__trackerDate);if(v.__trackerRef)return db.doc(v.__trackerRef);if(Array.isArray(v))return v.map(x=>unpack(x,db));return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,unpack(x,db)]));}
function canonical(v){if(v===null||typeof v!=='object')return JSON.stringify(v);if(v instanceof Date)return JSON.stringify(['time',Math.floor(+v/1000),((+v%1000)+1000)%1000*1000000]);if(typeof v.toDate==='function')return Number.isInteger(v.seconds)?JSON.stringify(['time',v.seconds,v.nanoseconds]):canonical(v.toDate());if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const code=e=>String(e?.code||'').replace(/^firestore\//,'');
async function digest(text){const bytes=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function integrity(snapshot){
 const counts={players:0,rounds:0,sessions:0},seen=new Set(),rows=[...snapshot.rows].sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
 for(const [p]of rows){if(!validPath(p)||seen.has(p))throw Error('Invalid cache record');seen.add(p);counts[p.split('/')[0]]++;}
 return {version:1,total:rows.length,counts,sha256:await digest(canonical(pack({epoch:snapshot.epoch,revision:snapshot.revision,rows})))};
}
async function validSnapshot(snapshot){try{return Number.isSafeInteger(snapshot.epoch)&&Number.isSafeInteger(snapshot.revision)&&snapshot.revision>=0&&canonical(snapshot.integrity)===canonical(await integrity(snapshot));}catch{return false;}}
function copyIntent(value){if(value instanceof Date)return new Date(+value);if(Array.isArray(value))return value.map(copyIntent);if(value&&Object.getPrototypeOf(value)===Object.prototype)return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,copyIntent(v)]));return value;}
function prepareCommit(db,operations,before,expectedRevision){
 operations=operations.map(o=>({...o,data:copyIntent(o.data),options:copyIntent(o.options)}));
 if(!operations.length)return {execute:async()=>{}};if(operations.length>450)throw Error('Split tracker changes into batches of at most 450');
 const paths=[...new Set(operations.map(o=>o.ref.path))].sort();if(!paths.every(validPath))throw Error('Invalid public tracker operation');
 const expected=before&&new Map(paths.map(p=>[p,copyIntent(before.get(p)||null)]));
 const event=db.collection('trackerChanges').doc(),state=db.doc('trackerSync/state');let pending;
 async function execute(){for(let attempt=0;attempt<6;attempt++){
  let attempted=null;
  try{return await db.runTransaction(async tx=>{
   const existing=await tx.get(event);if(existing.exists)return;
   const s=await tx.get(state),head=s.exists?s.data():{epoch:1,mode:'prepare',revision:0,enforced:false};attempted=head;
   if(expectedRevision!==undefined&&head.revision!==expectedRevision)throw Error('Scores changed. Wait for synchronization and review before saving.');
   for(const path of paths){const d=await tx.get(db.doc(path));if(expected&&canonical(d.exists?d.data():null)!==canonical(expected.get(path)||null))throw Error('Record changed. Refresh and retry; newer data was kept.');}
   const revision=head.revision+1;if(!Number.isSafeInteger(revision))throw Error('Invalid tracker revision');
   for(const o of operations){if(o.type==='delete')tx.delete(o.ref);else if(o.type==='update')tx.update(o.ref,o.data);else if(o.options)tx.set(o.ref,o.data,o.options);else tx.set(o.ref,o.data);}
   tx.set(event,{epoch:head.epoch,revision,paths});tx.set(state,{...head,revision,eventId:event.id,paths});
  });}catch(e){
   if(!attempted||!['permission-denied','aborted','unavailable','deadline-exceeded','unknown'].includes(code(e)))throw e;
   // Resolve a lost commit response before retrying the ORIGINAL immutable event.
   let latest;try{if((await event.get({source:'server'})).exists)return;latest=(await state.get({source:'server'})).data();}catch{throw e;}
   const advanced=latest&&latest.epoch===attempted.epoch&&latest.mode===attempted.mode&&latest.enforced===attempted.enforced&&latest.revision>attempted.revision;
   if(attempt===5||code(e)==='permission-denied'&&!advanced)throw e;
   await pause(Math.min(400,25*2**attempt)+Math.floor(Math.random()*25));
  }
 }}
 return {eventId:event.id,execute(){if(!pending)pending=execute().finally(()=>pending=null);return pending;}};
}
async function commit(db,operations,before,expectedRevision){return prepareCommit(db,operations,before,expectedRevision).execute();}

class Client{
 constructor(db,cache,{onData=()=>{},onStatus=()=>{},onMode=()=>{},pageSize=150,eventPageSize=25}={}){if(pageSize<2||pageSize>500||eventPageSize<1||eventPageSize>100)throw Error('Invalid sync page size');Object.assign(this,{db,cache,onData,onStatus,onMode,pageSize,eventPageSize});this.rows=new Map();this.revision=-1;this.epoch=-1;this.generation=0;this.loading=null;this.pending=false;this.failures=0;this.retryAt=0;try{this.retryAt=Number(localStorage.getItem('trackerSyncRetryAt'))||0;}catch{}this.running=false;}
 async init(){try{const saved=await this.cache.load();if(saved){if(!saved.integrity||await validSnapshot(saved)){this.rows=new Map(saved.rows);this.integrity=saved.integrity;this.revision=saved.integrity?saved.revision:-1;this.epoch=saved.integrity?saved.epoch:-1;this.onData(saved,false);}}}catch{}this.start();}
 start(){if(this.running)return;if(this.retryAt>Date.now()){this.onStatus('paused');this.timer=setTimeout(()=>this.start(),this.retryAt-Date.now());return;}this.running=true;const gen=++this.generation;this.unsubscribe=this.db.doc('trackerSync/state').onSnapshot({includeMetadataChanges:true},s=>{if(!this.running||gen!==this.generation)return;if(s.metadata?.fromCache||s.metadata?.hasPendingWrites){this.onStatus('saved');return;}const h=readerHead(s.exists?s.data():{mode:'prepare',revision:0,epoch:1});this.mode=h.mode;this.onMode(h.mode);if(h.mode==='incremental')this.refresh(h).catch(()=>{});},e=>this.failed(e));}
 stop(){this.running=false;this.generation++;this.unsubscribe?.();this.unsubscribe=null;clearTimeout(this.timer);this.onStatus('saved');}
 async refresh(head){if(!this.running)return;if(Date.now()<this.retryAt){this.onStatus('paused');return;}if(this.loading){this.pending=true;return this.loading;}const gen=this.generation;this.loading=this.run(head,gen).catch(e=>{this.failed(e);throw e;}).finally(()=>{this.loading=null;if(this.pending&&this.running){this.pending=false;this.refresh().catch(()=>{});}});return this.loading;}
 async getHead(){const s=await this.db.doc('trackerSync/state').get({source:'server'});return readerHead(s.exists?s.data():{mode:'prepare',revision:0,epoch:1});}
 async run(head,gen){
  let target=head?readerHead(head):await this.getHead();if(target.mode!=='incremental'){this.mode=target.mode;this.onMode(target.mode);return;}
  if(this.epoch===target.epoch&&this.revision>target.revision)target=await this.getHead();this.onStatus('syncing');if(this.revision>=0&&!await validSnapshot({rows:[...this.rows],epoch:this.epoch,revision:this.revision,integrity:this.integrity})){this.revision=-1;this.epoch=-1;this.rows=new Map();this.integrity=null;}const epoch=target.epoch;let rows=new Map(this.rows),cursor=this.revision;
  if(this.epoch!==target.epoch||cursor<0||cursor>target.revision){cursor=target.revision;rows=new Map();for(const name of collections){let after=null;for(;;){if(!this.running||gen!==this.generation)return;let q=this.db.collection(name).orderBy(firebase.firestore.FieldPath.documentId()).limit(this.pageSize);if(after)q=q.startAfter(after);const page=await q.get({source:'server'});for(const d of page.docs)rows.set(name+'/'+d.id,d.data());if(page.docs.length<this.pageSize)break;after=page.docs.at(-1).id;}}target=await this.getHead();}
  for(let pass=0;pass<8;pass++){
   if(!this.running||gen!==this.generation)return;if(target.mode!=='incremental'||target.epoch!==epoch){this.mode=target.mode;this.onMode(target.mode);return;}
   const changed=new Set();while(cursor<target.revision){const page=await this.db.collection('trackerChanges').where('revision','>',cursor).where('revision','<=',target.revision).orderBy('revision').limit(this.eventPageSize).get({source:'server'});if(!page.docs.length)throw Error('Tracker change journal has a gap; complete verification required');for(const d of page.docs){const e=d.data();if(e.epoch!==epoch||e.revision!==cursor+1||!Array.isArray(e.paths)||!e.paths.every(validPath))throw Error('Invalid tracker change sequence');e.paths.forEach(p=>changed.add(p));cursor=e.revision;}}
   const paths=[...changed];for(let i=0;i<paths.length;i+=20){const chunk=paths.slice(i,i+20),docs=await Promise.all(chunk.map(p=>this.db.doc(p).get({source:'server'})));docs.forEach((d,j)=>{if(d.exists)rows.set(chunk[j],d.data());else rows.delete(chunk[j]);});}
   const latest=changed.size?await this.getHead():target;if(latest.mode!=='incremental'||latest.epoch!==target.epoch){this.revision=-1;this.pending=true;return;}if(latest.revision!==cursor){target=latest;continue;}
   if(!this.running||gen!==this.generation||this.mode&&this.mode!=='incremental')return;const snapshot={rows:[...rows],revision:cursor,epoch:target.epoch,savedAt:Date.now()};snapshot.integrity=await integrity(snapshot);await this.cache.save(snapshot);if(!this.running||gen!==this.generation)return;this.rows=rows;this.integrity=snapshot.integrity;this.revision=cursor;this.epoch=target.epoch;this.failures=0;this.retryAt=0;try{localStorage.removeItem('trackerSyncRetryAt');}catch{}this.onData(snapshot,true);this.onStatus('current');return;
  }
  this.pending=true;
 }
 failed(e){if(!this.running)return;if(/journal has a gap|Invalid tracker change sequence/.test(e.message)){this.revision=-1;this.epoch=-1;}const quota=String(e.code||e.message).includes('resource-exhausted'),delay=quota?300000:Math.min(60000,1000*2**Math.min(this.failures++,6));this.retryAt=Date.now()+delay;try{localStorage.setItem('trackerSyncRetryAt',String(this.retryAt));}catch{}this.unsubscribe?.();this.unsubscribe=null;this.onStatus(quota?'quota':'offline');clearTimeout(this.timer);this.timer=setTimeout(()=>{this.running=false;this.start();},delay);}
}
return {Client,commit,prepareCommit,integrity,validSnapshot,pack,unpack,validPath,canonical};
});
