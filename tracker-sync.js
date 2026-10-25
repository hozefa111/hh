/* Public tracker changes only; no live rooms or private cards. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TrackerSync=api;})(typeof globalThis==='undefined'?this:globalThis,function(){
'use strict';
const collections=['players','rounds','sessions'];
const validPath=p=>/^(players|rounds|sessions)\/[a-zA-Z0-9_-]{1,240}$/.test(p);
function pack(v){if(v===null||typeof v!=='object')return v;if(v instanceof Date)return {__trackerDate:v.toISOString()};if(typeof v.toDate==='function'&&Number.isInteger(v.seconds))return {__trackerTimestamp:[v.seconds,v.nanoseconds]};if(Array.isArray(v))return v.map(pack);if(v.firestore&&typeof v.path==='string')return {__trackerRef:v.path};return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,pack(x)]));}
function unpack(v,db){if(v===null||typeof v!=='object')return v;if(v.__trackerTimestamp)return new firebase.firestore.Timestamp(...v.__trackerTimestamp);if(v.__trackerDate)return new Date(v.__trackerDate);if(v.__trackerRef)return db.doc(v.__trackerRef);if(Array.isArray(v))return v.map(x=>unpack(x,db));return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,unpack(x,db)]));}
function canonical(v){if(v===null||typeof v!=='object')return JSON.stringify(v);if(v instanceof Date)return JSON.stringify(['time',+v]);if(typeof v.toDate==='function')return JSON.stringify(['time',+v.toDate()]);if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';}
async function commit(db,operations,before,expectedRevision){
 if(!operations.length)return;if(operations.length>450)throw Error('Split tracker changes into batches of at most 450');
 const paths=[...new Set(operations.map(o=>o.ref.path))].sort();if(!paths.every(validPath))throw Error('Invalid public tracker operation');
 const event=db.collection('trackerChanges').doc(),state=db.doc('trackerSync/state');
 return db.runTransaction(async tx=>{
  const existing=await tx.get(event);if(existing.exists)return;
  const s=await tx.get(state),head=s.exists?s.data():{epoch:1,mode:'prepare',revision:0,enforced:false};
  if(expectedRevision!==undefined&&head.revision!==expectedRevision)throw Error('Scores changed. Wait for synchronization and review before saving.');
  for(const path of paths){const d=await tx.get(db.doc(path));if(before&&canonical(d.exists?d.data():null)!==canonical(before.get(path)||null))throw Error('Record changed. Refresh and retry; newer data was kept.');}
  const revision=head.revision+1;if(!Number.isSafeInteger(revision))throw Error('Invalid tracker revision');
  for(const o of operations){if(o.type==='delete')tx.delete(o.ref);else if(o.type==='update')tx.update(o.ref,o.data);else if(o.options)tx.set(o.ref,o.data,o.options);else tx.set(o.ref,o.data);}
  tx.set(event,{epoch:head.epoch,revision,paths});tx.set(state,{...head,revision,eventId:event.id,paths});
 });
}
class Client{
 constructor(db,cache,{onData=()=>{},onStatus=()=>{},onMode=()=>{},pageSize=150,eventPageSize=25}={}){if(pageSize<2||pageSize>500||eventPageSize<1||eventPageSize>100)throw Error('Invalid sync page size');Object.assign(this,{db,cache,onData,onStatus,onMode,pageSize,eventPageSize});this.rows=new Map();this.revision=-1;this.epoch=-1;this.generation=0;this.loading=null;this.pending=false;this.failures=0;this.retryAt=0;try{this.retryAt=Number(localStorage.getItem('trackerSyncRetryAt'))||0;}catch{}this.running=false;}
 async init(){try{const saved=await this.cache.load();if(saved){this.rows=new Map(saved.rows);this.revision=saved.revision;this.epoch=saved.epoch;this.onData(saved,false);}}catch{}this.start();}
 start(){if(this.running)return;if(this.retryAt>Date.now()){this.onStatus('paused');this.timer=setTimeout(()=>this.start(),this.retryAt-Date.now());return;}this.running=true;const gen=++this.generation;this.unsubscribe=this.db.doc('trackerSync/state').onSnapshot({includeMetadataChanges:true},s=>{if(!this.running||gen!==this.generation)return;if(s.metadata?.fromCache||s.metadata?.hasPendingWrites){this.onStatus('saved');return;}const h=s.exists?s.data():{mode:'prepare',revision:0,epoch:1};this.mode=h.mode;this.onMode(h.mode);if(h.mode==='incremental')this.refresh(h).catch(()=>{});},e=>this.failed(e));}
 stop(){this.running=false;this.generation++;this.unsubscribe?.();this.unsubscribe=null;clearTimeout(this.timer);this.onStatus('saved');}
 async refresh(head){if(!this.running)return;if(Date.now()<this.retryAt){this.onStatus('paused');return;}if(this.loading){this.pending=true;return this.loading;}const gen=this.generation;this.loading=this.run(head,gen).catch(e=>{this.failed(e);throw e;}).finally(()=>{this.loading=null;if(this.pending&&this.running){this.pending=false;this.refresh().catch(()=>{});}});return this.loading;}
 async getHead(){const s=await this.db.doc('trackerSync/state').get({source:'server'});return s.exists?s.data():{mode:'prepare',revision:0,epoch:1};}
 async run(head,gen){
  let target=head||await this.getHead();if(target.mode!=='incremental'){this.mode=target.mode;this.onMode(target.mode);return;}
  if(this.epoch===target.epoch&&this.revision>target.revision)target=await this.getHead();this.onStatus('syncing');const epoch=target.epoch;let rows=new Map(this.rows),cursor=this.revision;
  if(this.epoch!==target.epoch||cursor<0||cursor>target.revision){cursor=target.revision;rows=new Map();for(const name of collections){let after=null;for(;;){if(!this.running||gen!==this.generation)return;let q=this.db.collection(name).orderBy(firebase.firestore.FieldPath.documentId()).limit(this.pageSize);if(after)q=q.startAfter(after);const page=await q.get({source:'server'});for(const d of page.docs)rows.set(name+'/'+d.id,d.data());if(page.docs.length<this.pageSize)break;after=page.docs.at(-1).id;}}target=await this.getHead();}
  for(let pass=0;pass<8;pass++){
   if(!this.running||gen!==this.generation)return;if(target.mode!=='incremental'||target.epoch!==epoch){this.mode=target.mode;this.onMode(target.mode);return;}
   const changed=new Set();while(cursor<target.revision){const page=await this.db.collection('trackerChanges').where('revision','>',cursor).where('revision','<=',target.revision).orderBy('revision').limit(this.eventPageSize).get({source:'server'});if(!page.docs.length)throw Error('Tracker change journal has a gap; complete verification required');for(const d of page.docs){const e=d.data();if(e.epoch!==epoch||e.revision!==cursor+1||!Array.isArray(e.paths)||!e.paths.every(validPath))throw Error('Invalid tracker change sequence');e.paths.forEach(p=>changed.add(p));cursor=e.revision;}}
   const paths=[...changed];for(let i=0;i<paths.length;i+=20){const chunk=paths.slice(i,i+20),docs=await Promise.all(chunk.map(p=>this.db.doc(p).get({source:'server'})));docs.forEach((d,j)=>{if(d.exists)rows.set(chunk[j],d.data());else rows.delete(chunk[j]);});}
   const latest=changed.size?await this.getHead():target;if(latest.mode!=='incremental'||latest.epoch!==target.epoch){this.revision=-1;this.pending=true;return;}if(latest.revision!==cursor){target=latest;continue;}
   if(!this.running||gen!==this.generation||this.mode&&this.mode!=='incremental')return;const snapshot={rows:[...rows],revision:cursor,epoch:target.epoch,savedAt:Date.now()};await this.cache.save(snapshot);if(!this.running||gen!==this.generation)return;this.rows=rows;this.revision=cursor;this.epoch=target.epoch;this.failures=0;this.retryAt=0;try{localStorage.removeItem('trackerSyncRetryAt');}catch{}this.onData(snapshot,true);this.onStatus('current');return;
  }
  this.pending=true;
 }
 failed(e){if(!this.running)return;if(/journal has a gap|Invalid tracker change sequence/.test(e.message)){this.revision=-1;this.epoch=-1;}const quota=String(e.code||e.message).includes('resource-exhausted'),delay=quota?300000:Math.min(60000,1000*2**Math.min(this.failures++,6));this.retryAt=Date.now()+delay;try{localStorage.setItem('trackerSyncRetryAt',String(this.retryAt));}catch{}this.unsubscribe?.();this.unsubscribe=null;this.onStatus(quota?'quota':'offline');clearTimeout(this.timer);this.timer=setTimeout(()=>{this.running=false;this.start();},delay);}
}
return {Client,commit,pack,unpack,validPath,canonical};
});
