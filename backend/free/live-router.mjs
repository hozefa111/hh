import {DurableObject} from 'cloudflare:workers';
import {Identity} from './identity.mjs';
import {Firestore} from './firestore.mjs';
import {failure} from './errors.mjs';
import R from '../../functions/online/shared/engine.js';
export const liveId=id=>/^cf2_[a-f0-9]{32}$/.test(id||'');
export class KaliLiveDirectory extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.ctx=ctx;this.sql=ctx.storage.sql;this.sql.exec('CREATE TABLE IF NOT EXISTS live_rooms(id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, owner TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL DEFAULT 0)');this.sql.exec('CREATE TABLE IF NOT EXISTS live_members(uid TEXT NOT NULL, room TEXT NOT NULL, PRIMARY KEY(uid,room))');}
 async fetch(request){const b=await request.json();let result;this.ctx.storage.transactionSync(()=>{
  if(b.op==='existing')result=[...this.sql.exec('SELECT id,code,owner FROM live_rooms WHERE id=?',b.id)][0]||null;
  else if(b.op==='lookup')result=[...this.sql.exec('SELECT id FROM live_rooms WHERE code=?',b.code)][0]?.id||null;
  else if(b.op==='reserve'){
   const old=[...this.sql.exec('SELECT code FROM live_rooms WHERE id=?',b.id)][0];if(old){result={code:old.code};return;}
   if([...this.sql.exec('SELECT id FROM live_rooms WHERE code=?',b.code)].length){result={collision:true};return;}
   this.sql.exec('INSERT INTO live_rooms(id,code,owner,created) VALUES(?,?,?,?)',b.id,b.code,b.uid,Date.now());result={code:b.code};
  }else if(b.op==='update'){this.sql.exec('UPDATE live_rooms SET active=?,revision=? WHERE id=? AND revision<=?',b.status==='stopped'?0:1,b.revision,b.id,b.revision);result={ok:true};
  }else if(b.op==='member'){this.sql.exec('INSERT OR IGNORE INTO live_members(uid,room) VALUES(?,?)',b.uid,b.room);result={ok:true};}
  else if(b.op==='scoreList'){const c=b.cursor,rows=[...this.sql.exec('SELECT m.room,r.active,r.created FROM live_members m JOIN live_rooms r ON r.id=m.room WHERE m.uid=?'+(c?' AND (r.active,r.created,r.id)<(?,?,?)':'')+' ORDER BY r.active DESC,r.created DESC,r.id DESC LIMIT 26',b.uid,...(c?[c.active,c.created,c.id]:[]))];const page=rows.slice(0,25),last=page.at(-1);result={rows:page,next:rows.length>25?{active:last.active,created:last.created,id:last.room}:null};}
  else if(b.op==='list')result=[...this.sql.exec('SELECT m.room FROM live_members m JOIN live_rooms r ON r.id=m.room WHERE m.uid=? AND r.active=1 ORDER BY r.created DESC LIMIT 100',b.uid)].map(r=>r.room);
  else throw Error('Unsupported directory operation');
 });return Response.json(result);}
}
let identityCache;function sharedIdentity(env){if(!identityCache||identityCache.project!==env.FIREBASE_PROJECT_ID||identityCache.credential!==env.FIREBASE_SERVICE_ACCOUNT)identityCache={project:env.FIREBASE_PROJECT_ID,credential:env.FIREBASE_SERVICE_ACCOUNT,identity:new Identity(env)};return identityCache.identity;}
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
export async function liveRoute(request,env){
 const url=new URL(request.url),socket=url.pathname==='/kaliSocket';if(!socket&&url.pathname!=='/kaliApi')return null;
 const body=socket?null:await request.clone().json();
 const directory=async b=>(await env.KALI_LIVE_DIRECTORY.getByName('directory-v2').fetch(new Request('https://directory/',{method:'POST',body:JSON.stringify(b)}))).json();
 const oldJoin=!socket&&((body.action?.type==='join'||body.operation==='liveProfiles')&&!body.roomId);
 let roomId=socket?url.searchParams.get('roomId'):body.operation==='sessionHistory'?body.sessionId:body.roomId;
 if(oldJoin&&env.KALI_LIVE_DIRECTORY){const found=await directory({op:'lookup',code:String(body.code||'').trim().toUpperCase()});if(found)roomId=found;}
 const createRequest=body?.operation==='create'&&!!env.KALI_LIVE_DIRECTORY&&Number(body.clientProtocol)>=2,creation=body?.operation==='create'&&String(env.ENABLE_CLOUDFLARE_V2)==='true',rooms=['liveRooms','scoreboardRooms'].includes(body?.operation),transport=body?.operation==='transport';
 if(!socket&&!liveId(roomId)&&!creation&&!createRequest&&!rooms&&!transport)return null;
 const target=id=>env.KALI_LIVE_ROOMS.getByName(id);
 if(socket){if(!liveId(roomId))return Response.json({error:'Invalid room'},{status:400});return target(roomId).fetch(request);}
 if(Number(body.clientProtocol)<2||!body.clientProtocol)return Response.json({error:'Update Required: install the latest 3 Patti PRO to use this room.',code:'UPDATE_REQUIRED'},{status:426});
 const token=/^Bearer (.+)$/.exec(request.headers.get('Authorization')||'');if(!token)throw Error('Sign in required');
 const identity=sharedIdentity(env),who=await identity.verify(token[1]);
 const call=async(id,b,profile=null)=>target(id).fetch(new Request('https://room/',{method:'POST',body:JSON.stringify({who,body:b,profile})}));
 if(transport)return Response.json({transport:liveId(roomId)?'cloudflare-v2':'firestore',serverNow:Date.now()});
 if(body.operation==='scoreboardRooms'){const c=body.cursor;if(c&&(![0,1].includes(c.active)||!Number.isSafeInteger(c.created)||!liveId(c.id)))throw Error('Invalid session cursor');const page=await directory({op:'scoreList',uid:who.uid,cursor:c}),rows=[],removed=[];for(const {room:id}of page.rows){const res=await call(id,{operation:'liveDirectory',includeScores:true});if(res.ok)rows.push(await res.json());else if((await res.json()).error?.includes('Session was deleted'))removed.push(id);}return Response.json({rooms:rows,removed,next:page.next,serverNow:Date.now()});}
 if(rooms){const ids=await directory({op:'list',uid:who.uid}),rows=[];for(const id of ids){const res=await call(id,{operation:'liveDirectory'});if(res.ok){const row=await res.json();if(row.status!=='stopped')rows.push(row);}}return Response.json({rooms:rows,serverNow:Date.now()});}
 if(creation||createRequest){
  if(!/^[a-zA-Z0-9_-]{8,100}$/.test(body.commandId||''))throw Error('Command ID required');
  const candidateId='cf2_'+(await digest(who.uid+':'+body.commandId)).slice(0,32),existing=await directory({op:'existing',id:candidateId});
  if(existing){const receipt=await call(candidateId,{operation:'creationReceipt',fingerprint:JSON.stringify(body)});if(receipt.ok){await directory({op:'member',uid:who.uid,room:candidateId});return receipt;}if(!creation)return Response.json({error:'Room creation is pending. Retry the original request after service recovery.'},{status:503});}
  if(!creation)return null;
  const db=new Firestore(env.FIREBASE_PROJECT_ID,()=>identity.token());who.admin=who.admin||!!await db.get('admins/'+who.uid);if(!who.admin)throw Error('Admin access required');
  const profiles={};let after=null;for(;;){const page=await db.scan('players',after,100);for(const p of page)profiles[p.id]=p.data;if(page.length<100)break;after=page.at(-1).id;}
  if(!profiles[body.playerId])throw Error('Choose an existing player');roomId='cf2_'+(await digest(who.uid+':'+body.commandId)).slice(0,32);
  let code;for(let attempt=0;attempt<10;attempt++){const hash=await digest(roomId+':'+attempt),candidate='V2'+hash.slice(0,6).split('').map(c=>'ABCDEFGHJKLMNPQR'[parseInt(c,16)]).join(''),saved=await directory({op:'reserve',id:roomId,code:candidate,uid:who.uid});if(saved.code){code=saved.code;break;}}if(!code)throw Error('Room code unavailable');
  const sessionName=String(body.sessionName||'Online · '+code).trim();if(!sessionName||sessionName.length>80)throw Error('Session name must be 1–80 characters');
  const room=R.create({id:roomId,code,uid:who.uid,name:profiles[body.playerId].name,playerId:body.playerId,sessionName,mode:body.mode,config:body.config,difficulty:body.difficulty},Date.now());
  const res=await call(roomId,{operation:'init',room,profiles,createFingerprint:JSON.stringify(body)});if(res.ok)await directory({op:'member',uid:who.uid,room:roomId});return res;
 }
 if(body.operation&&!['snapshot','socketTicket','scoreboardTicket','liveHistory','sessionHistory','liveDirectory','liveStats','liveProfiles'].includes(body.operation))throw Error('Unsupported live operation');
 let profile=null;if(['join','approve','reserve'].includes(body.action?.type)&&body.action.playerId){const p=body.action.playerId;if(!/^[-a-zA-Z0-9_]{1,128}$/.test(p))throw Error('Invalid player profile');const check=await call(roomId,{operation:'hasProfile',playerId:p});if(!check.ok)return check;const known=await check.json();if(body.action.type!=='join'&&!known.owner)throw Error('Only room admin can manage this session');if(!known.known){const value=await new Firestore(env.FIREBASE_PROJECT_ID,()=>identity.token()).get('players/'+p);if(!value)throw Error('Player profile not found');profile={id:p,value};}}
 const res=await call(roomId,{...body,roomId},profile);if(res.ok&&body.action?.type==='join')await directory({op:'member',uid:who.uid,room:roomId});return res;
}
