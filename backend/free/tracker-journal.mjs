// Public tracker invalidations only. Private gameplay never enters this journal.
export const trackerPath=path=>/^(players|rounds|sessions)\/[a-zA-Z0-9_-]{1,240}$/.test(path);
export function changedTrackerPaths(writes,root){return [...new Set(writes.map(w=>(w.update?.name||w.delete||'').replace(root+'/','')).filter(trackerPath))].sort();}
export async function journalWrites(db,transaction,writes){
 const paths=changedTrackerPaths(writes,db.root);if(!paths.length)return writes;
 if(paths.length>200)throw Error('Tracker commit exceeds 200 changed records');
 const prior=await db.get('trackerSync/state',transaction),head=prior||{revision:0,epoch:1,mode:'prepare'},revision=head.revision+1,eventId=crypto.randomUUID().replaceAll('-','');
 if(!Number.isSafeInteger(revision))throw Error('Invalid tracker revision');
 const event={revision,epoch:head.epoch,paths},next={...head,revision,eventId,paths};
 return [...writes,db.set('trackerChanges/'+eventId,event,true),db.set('trackerSync/state',next)];
}
