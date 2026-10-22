import {test} from 'node:test';
import A from 'node:assert/strict';
import {KeyedQueue,Slots,Timings} from '../coordination.mjs';
import {Identity} from '../identity.mjs';
import {generateKeyPair,exportPKCS8} from 'jose';
const gate=()=>{let release;const promise=new Promise(r=>release=r);return {promise,release};};
test('held room cannot block another room; same room stays ordered after failure',async()=>{
 const q=new KeyedQueue(),g=gate(),order=[];
 const a=q.run('A',async()=>{order.push('A1');await g.promise;throw Error('Temporary outage');});const rejected=A.rejects(a,/outage/);
 const a2=q.run('A',()=>order.push('A2'));
 await q.run('B',()=>order.push('B'));A.deepEqual(order,['A1','B']);g.release();await rejected;await a2;A.deepEqual(order,['A1','B','A2']);await new Promise(r=>setTimeout(r,0));A.equal(q.tails.size,0);
});
test('presence jobs are bounded to four and release capacity on failures',async()=>{
 const slots=new Slots(4),g=gate();let entered=0,peak=0;
 const jobs=Array.from({length:9},(_,i)=>slots.run(async()=>{entered++;peak=Math.max(peak,entered);try{await g.promise;if(i===0)throw Error('Failure');}finally{entered--;}}));
 await new Promise(r=>setTimeout(r,0));A.equal(entered,4);g.release();const results=await Promise.allSettled(jobs);A.equal(peak,4);A.equal(results.filter(x=>x.status==='rejected').length,1);A.equal(slots.active,0);
});
test('timings report bounded numeric stages even for rejected work',async()=>{
 const t=new Timings();await A.rejects(t.measure('read',()=>Promise.reject(Error('private secret'))));const h=t.headers('opaque');A.match(h['Server-Timing'],/read;dur=[0-9.]+/);A.match(h['Server-Timing'],/total;dur=[0-9.]+/);A(!JSON.stringify(h).includes('secret'));
});
test('concurrent credential refresh is single-flight; failed refresh can recover',async()=>{
 const {privateKey}=await generateKeyPair('RS256',{extractable:true}),private_key=await exportPKCS8(privateKey),g=gate();let calls=0,fail=true;
 const identity=new Identity({FIREBASE_PROJECT_ID:'demo',FIREBASE_SERVICE_ACCOUNT:JSON.stringify({project_id:'demo',client_email:'test@demo',private_key})},async()=>{calls++;await g.promise;return fail?Response.json({},{status:503}):Response.json({access_token:'test-token',expires_in:3600});});
 const requests=Array.from({length:8},()=>identity.token());g.release();const results=await Promise.allSettled(requests);A.equal(calls,1);A(results.every(r=>r.status==='rejected'));fail=false;A.equal(await identity.token(),'test-token');A.equal(calls,2);A.equal(await identity.token(),'test-token');A.equal(calls,2);
});
