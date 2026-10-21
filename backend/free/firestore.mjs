// Firestore REST keeps the existing Spark database and ledger; credentials stay server-only.
export function encode(value) {
 if(value===null)return {nullValue:null};
 if(value instanceof Date)return {timestampValue:value.toISOString()};
 if(Array.isArray(value))return {arrayValue:{values:value.map(encode)}};
 if(typeof value==='object')return {mapValue:{fields:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)]))}};
 if(typeof value==='number')return Number.isInteger(value)?{integerValue:String(value)}:{doubleValue:value};
 if(typeof value==='boolean')return {booleanValue:value};
 if(typeof value==='string')return {stringValue:value};
 throw Error('Unsupported persisted value');
}
export function decode(v){
 if('nullValue'in v)return null;if('timestampValue'in v)return new Date(v.timestampValue);
 if('arrayValue'in v)return (v.arrayValue.values||[]).map(decode);
 if('mapValue'in v)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x)]));
 if('integerValue'in v)return Number(v.integerValue);if('doubleValue'in v)return v.doubleValue;
 if('booleanValue'in v)return v.booleanValue;if('stringValue'in v)return v.stringValue;
 throw Error('Unsupported Firestore field');
}
export class Firestore {
 constructor(project,token,fetcher=(...args)=>fetch(...args),{origin='https://firestore.googleapis.com'}={}){this.project=project;this.token=token;this.fetcher=fetcher;this.origin=origin;this.root=`projects/${project}/databases/(default)/documents`;}
 name(path){if(!path.split('/').every(s=>/^[a-zA-Z0-9_-]{1,240}$/.test(s)))throw Error('Invalid document path');return this.root+'/'+path;}
 async request(suffix,method='GET',body){
  const res=await this.fetcher(this.origin+'/v1/'+this.root+suffix,{method,headers:{Authorization:'Bearer '+await this.token(),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
  const data=await res.json();if(!res.ok){const e=Error('Database operation failed');e.status=res.status;e.code=data.error?.status;throw e;}return data;
 }
 async get(path,transaction){
  const name=this.name(path);
  if(transaction)return (await this.getMany([path],transaction))[0];
  try{const d=await this.request('/'+path);const data=decode({mapValue:{fields:d.fields||{}}});Object.defineProperty(data,'_cascadeVersion',{value:d.updateTime||null});return data;}catch(e){if(e.status===404)return null;throw e;}
 }
 async getMany(paths,transaction){
  const documents=paths.map(path=>this.name(path));
  const rows=await this.request(':batchGet','POST',{documents,...(transaction?{transaction}:{})});
  const found=new Map(rows.filter(r=>r.found).map(r=>[r.found.name,r.found]));
  return documents.map(name=>{const doc=found.get(name);if(!doc)return null;const data=decode({mapValue:{fields:doc.fields||{}}});Object.defineProperty(data,'_cascadeVersion',{value:doc.updateTime||null});return data;});
 }
 async scan(collection,after,limit=100,transaction){
  const structuredQuery={from:[{collectionId:collection.split('/').at(-1)}],orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],limit};
  if(after)structuredQuery.startAt={before:false,values:[{referenceValue:this.name(collection+'/'+after)}]};
  const parent=collection.includes('/')?'/'+collection.slice(0,collection.lastIndexOf('/')):'';
  const rows=await this.request(parent+':runQuery','POST',{structuredQuery,...(transaction?{transaction}:{})});
  return rows.filter(r=>r.document).map(({document:d})=>({id:d.name.split('/').at(-1),data:decode({mapValue:{fields:d.fields||{}}}),version:d.updateTime||null}));
 }
 set(path,value,create=false){return {update:{name:this.name(path),fields:encode(value).mapValue.fields},...(create?{currentDocument:{exists:false}}:{})};}
 delete(path){return {delete:this.name(path)};}
 async transaction(fn){
  for(let attempt=0;attempt<5;attempt++){
   const {transaction}=await this.request(':beginTransaction','POST',{options:{readWrite:{}}});
   try{const {writes,result}=await fn(transaction);await this.request(':commit','POST',{transaction,writes});return result;}
   catch(e){await this.request(':rollback','POST',{transaction}).catch(()=>{});if(e.code!=='ABORTED'||attempt===4)throw e;}
  }
 }
}
