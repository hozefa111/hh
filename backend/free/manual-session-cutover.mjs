// Operator-only, read-only by default. Does not change tracker mode/epoch or any score record.
import {readFile} from 'node:fs/promises';
import {Identity} from './identity.mjs';
import {Firestore} from './firestore.mjs';
import Guard from '../../online/shared/manual-session.js';
import {pathToFileURL} from 'node:url';

export async function inspect(db,tx){
 const head=await db.get('trackerSync/state',tx),pointer=await db.get('meta/manualSession',tx),active=[];let after=null;
 for(;;){const rows=await db.scan('sessions',after,150,tx);for(const {id,data}of rows)if(Guard.active(id,data))active.push(id);if(rows.length<150)break;after=rows.at(-1).id;}
 if(active.length>1)throw Error('Multiple active manual sessions already exist; review them before enabling the guard. No records were changed.');
 if(!head||head.enforced!==true)throw Error('Verified journal enforcement is required. No settings were changed.');
 return {head,pointer,proposed:{sessionId:active[0]||null}};
}
export async function cutover(db,{apply=false,disable=false,editorsUpdated=false,rulesVerified=false}={}){
 if(apply&&!disable&&(!editorsUpdated||!rulesVerified))throw Error('Activation requires confirmed updated editors and verified deployed guard rules.');
 const before=await inspect(db);if(!apply)return {apply:false,pointer:before.pointer,proposed:disable?null:before.proposed,revision:before.head.revision};
 return db.transaction(async tx=>{const current=await inspect(db,tx);const next=disable?null:current.proposed;
  if(!disable&&current.pointer&&current.pointer.sessionId!==next.sessionId)throw Error('Existing guard disagrees with the session ledger; do not overwrite it.');
  return {writes:disable?(current.pointer?[db.delete('meta/manualSession')]:[]):current.pointer?[]:[db.set('meta/manualSession',next,true)],result:{apply:true,pointer:next,revision:current.head.revision}};
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const args=process.argv.slice(2),project=args[args.indexOf('--project')+1],file=process.env.TRACKER_SERVICE_ACCOUNT_FILE;
 if(!args.includes('--project')||!project||!file)throw Error('Specify --project and TRACKER_SERVICE_ACCOUNT_FILE; default is read-only dry-run.');
 const credential=JSON.parse(await readFile(file,'utf8'));if(credential.project_id!==project)throw Error('Project mismatch');
 const identity=new Identity({FIREBASE_PROJECT_ID:project,FIREBASE_SERVICE_ACCOUNT:JSON.stringify(credential)}),db=new Firestore(project,()=>identity.token());
 console.log(JSON.stringify({project,...await cutover(db,{apply:args.includes('--apply'),disable:args.includes('--disable'),editorsUpdated:args.includes('--editors-updated'),rulesVerified:args.includes('--rules-verified')})}));
}
