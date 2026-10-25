'use strict';
// Optional Firebase Functions adapter uses the same atomic public invalidations as Workers.
async function journalTransaction(db,fn){return db.runTransaction(async real=>{
 const pending=[],paths=new Set();let proxy;proxy=new Proxy(real,{get(target,key){if(['set','update','delete','create'].includes(key))return (...args)=>{pending.push([key,args]);if(/^(players|rounds|sessions)\/[a-zA-Z0-9_-]{1,240}$/.test(args[0].path))paths.add(args[0].path);return proxy;};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 const result=await fn(proxy);let journal;
 if(paths.size){if(paths.size>450)throw Error('Tracker batch too large');const state=db.doc('trackerSync/state'),saved=await real.get(state),head=saved.exists?saved.data():{mode:'prepare',epoch:1,revision:0,enforced:false},event=db.collection('trackerChanges').doc(),ordered=[...paths].sort(),revision=head.revision+1;journal={state,event,data:{epoch:head.epoch,revision,paths:ordered},head:{...head,revision,eventId:event.id,paths:ordered}};}
 for(const [name,args]of pending)real[name](...args);if(journal){real.create(journal.event,journal.data);real.set(journal.state,journal.head);}return result;
 });}
module.exports={journalTransaction};
