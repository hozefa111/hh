import {test} from 'node:test';import assert from 'node:assert/strict';import {failure} from '../errors.mjs';
test('quota and infrastructure failures remain retryable, auth refresh is distinguishable, validation stays definitive',async()=>{
 const quota=Object.assign(Error('Firebase database quota exhausted; rooms preserved'),{status:429,code:'RESOURCE_EXHAUSTED',retryAfter:300}),r=failure(quota);assert.equal(r.status,429);assert.equal(r.headers.get('Retry-After'),'300');assert.equal((await r.json()).code,'RESOURCE_EXHAUSTED');
 assert.equal(failure(Object.assign(Error('private database detail'),{status:503})).status,503);assert.equal(failure({name:'JWTExpired'}).status,401);assert.equal(failure(Error('Illegal card')).status,400);
});
