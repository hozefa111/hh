// Only durations are exposed. No identities, commands or private state enter timing data.
export class Timings {
 constructor(){this.started=performance.now();this.values=new Map();}
 add(name,ms){this.values.set(name,(this.values.get(name)||0)+Math.max(0,ms));}
 async measure(name,fn){const start=performance.now();try{return await fn();}finally{this.add(name,performance.now()-start);}}
 headers(requestId){return {'X-Request-ID':requestId,'Server-Timing':[...this.values,['total',performance.now()-this.started]].map(([k,v])=>`${k};dur=${v.toFixed(1)}`).join(', ')};}
}
export class KeyedQueue {
 constructor(){this.tails=new Map();}
 run(key,fn,timings){const start=performance.now(),prior=this.tails.get(key)||Promise.resolve();const result=prior.then(()=>{timings?.add('queue',performance.now()-start);return fn();});const tail=result.catch(()=>{});this.tails.set(key,tail);tail.then(()=>{if(this.tails.get(key)===tail)this.tails.delete(key);});return result;}
}
export class Slots {
 constructor(limit=4){this.limit=limit;this.active=0;this.waiters=[];}
 async run(fn){if(this.active>=this.limit)await new Promise(resolve=>this.waiters.push(resolve));else this.active++;try{return await fn();}finally{const next=this.waiters.shift();if(next)next();else this.active--;}}
}
