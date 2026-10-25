// SQLite is the authority for v2 rooms. Public/private projections leave only via the room actor.
import R from '../../functions/online/shared/engine.js';
import metadata from '../../functions/online/metadata.js';
export class LiveStore {
 constructor(storage){this.storage=storage;this.metrics={rowsRead:0,rowsWritten:0};this.sql={exec:(query,...args)=>{const cursor=storage.sql.exec(query,...args),rows=[...cursor];this.metrics.rowsRead+=cursor.rowsRead||0;this.metrics.rowsWritten+=cursor.rowsWritten||0;return rows;}};
  this.sql.exec('CREATE TABLE IF NOT EXISTS live_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  this.sql.exec('CREATE TABLE IF NOT EXISTS live_receipts (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL)');
  this.sql.exec('CREATE TABLE IF NOT EXISTS live_outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE NOT NULL, payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, due INTEGER NOT NULL DEFAULT 0)');
  this.sql.exec('CREATE TABLE IF NOT EXISTS live_hands (number INTEGER PRIMARY KEY, payload TEXT NOT NULL)');
 }
 read(key){const row=[...this.sql.exec('SELECT value FROM live_meta WHERE key = ?',key)][0];return row?JSON.parse(row.value):null;}
 write(key,value){this.sql.exec('INSERT INTO live_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,JSON.stringify(value));}
 profile(id){return Promise.resolve(this.read('profiles')?.[id]||null);}
 lookup(){throw Error('Room lookup belongs to the directory');}
 async create(room){this.storage.transactionSync(()=>{if(this.read('room'))throw Error('Room already exists');room.transport='cloudflare-v2';room.scoreboardRevision=0;this.write('room',room);this.write('directoryDirty',room.revision);});}
 async transact(id,key,fingerprint,fn){return this.storage.transactionSync(()=>{
  const before=this.read('room');if(!before||before.id!==id)throw Error('Room not found');if(this.read('deleted'))throw Error('Session was deleted');
  if(key){const old=[...this.sql.exec('SELECT fingerprint,result FROM live_receipts WHERE key=?',key)][0];if(old){if(old.fingerprint!==fingerprint)throw Error('Command ID already used');return JSON.parse(old.result);}}
  const {next,result}=fn(before);
  if(next){this.enqueue(before,next);this.write('room',next);}
  if(key)this.sql.exec('INSERT INTO live_receipts(key,fingerprint,result) VALUES(?,?,?)',key,fingerprint,JSON.stringify(result));return result;
 });}
 enqueue(before,next){
  const seats=r=>Object.values(r.members).filter(p=>p.seat!==null&&p.status!=='Removed').map(p=>[p.playerId,p.seat]);
  const changed=before.completed!==next.completed||before.status!==next.status||before.paused!==next.paused||before.sessionName!==next.sessionName||JSON.stringify(before.scoreNames)!==JSON.stringify(next.scoreNames)||JSON.stringify(before.totals)!==JSON.stringify(next.totals)||JSON.stringify(seats(before))!==JSON.stringify(seats(next));
  next.scoreboardRevision=(before.scoreboardRevision||0)+(changed?1:0);
  if(before.status!==next.status)this.write('directoryDirty',next.revision);
  const h=next.hand,completed=h&&h.phase==='complete'&&next.completed>before.completed,voided=h&&h.phase==='void'&&before.hand?.phase!=='void';
  if(completed||voided){const result=completed?{...next.lastResult,handNumber:h.number,tricks:h.tricks,deckConfig:h.config}:{handId:h.id,handNumber:h.number,void:true,seatMap:h.seatMap,tricks:h.tricks,deckConfig:h.config,completedAt:Date.now()};this.sql.exec('INSERT INTO live_hands(number,payload) VALUES(?,?)',h.number,JSON.stringify(result));}
  if(completed||voided||next.status==='stopped'&&before.status!=='stopped'||next.sessionName!==before.sessionName){
   const key=completed?'hand:'+h.id:voided?'void:'+h.id:'meta:'+next.revision,payload={roomId:next.id,key,hand:completed||voided?this.history(h.number,1)[0]:null,round:completed?{...R.roundRecord(next),timestamp:new Date(h.completedAt).toISOString()}:null,session:{...metadata.sessionRecord(next),transport:'cloudflare-v2'},revision:next.revision};
   this.sql.exec('INSERT OR IGNORE INTO live_outbox(key,payload) VALUES(?,?)',key,JSON.stringify(payload));
  }
 }
 history(before=2147483647,limit=25){return [...this.sql.exec('SELECT payload FROM live_hands WHERE number <= ? ORDER BY number DESC LIMIT ?',before,limit)].map(r=>JSON.parse(r.payload));}
 pending(){return Number([...this.sql.exec('SELECT count(*) AS n FROM live_outbox')][0].n);}
 nextExport(){const r=[...this.sql.exec('SELECT seq,key,payload,attempts,due FROM live_outbox ORDER BY seq LIMIT 1')][0];return r?{...r,payload:JSON.parse(r.payload)}:null;}
 ack(seq){this.sql.exec('DELETE FROM live_outbox WHERE seq=?',seq);}
 defer(job,now,delay){this.sql.exec('UPDATE live_outbox SET attempts=attempts+1,due=? WHERE seq=?',now+delay,job.seq);}
}
