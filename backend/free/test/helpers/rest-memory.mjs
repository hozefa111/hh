import {encode,decode} from '../../firestore.mjs';
export class RestMemory {
 constructor(){this.docs=new Map;this.calls=[];}
 async fetch(url,init){
  this.calls.push({url,method:init.method});const body=init.body?JSON.parse(init.body):{},suffix=new URL(url).pathname.split('/documents')[1];
  if(suffix===':beginTransaction')return Response.json({transaction:'memory'});
  if(suffix===':rollback')return Response.json({});
  if(suffix===':batchGet')return Response.json([...(body.newTransaction?[{transaction:'memory'}]:[]),...body.documents.map(name=>{const fields=this.docs.get(name.split('/documents/')[1]);return fields?{found:{name,fields}}:{missing:name};})]);
  if(suffix.endsWith(':runQuery')){
   const q=body.structuredQuery,col=suffix.slice(1,-9),prefix=(col?col+'/':'')+q.from[0].collectionId+'/',timestamp=q.orderBy?.[0].field.fieldPath==='timestamp',cursor=q.startAt?.values,after=cursor?.at(-1).referenceValue.split('/documents/')[1],afterTime=timestamp&&cursor?+new Date(cursor[0].timestampValue):null;
   const matches=(data,w)=>{if(!w)return true;if(w.compositeFilter)return w.compositeFilter.filters.every(f=>matches(data,f));const f=w.fieldFilter,v=decode(f.value),actual=data[f.field.fieldPath];return f.op==='EQUAL'?actual===v:f.op==='GREATER_THAN_OR_EQUAL'?actual>=v:actual<=v;};
   const rows=[...this.docs.entries()].filter(([k,fields])=>k.startsWith(prefix)&&!k.slice(prefix.length).includes('/')&&matches(decode({mapValue:{fields}}),q.where)).sort(([a,af],[b,bf])=>{if(timestamp){const delta=+decode({mapValue:{fields:af}}).timestamp-+decode({mapValue:{fields:bf}}).timestamp;if(delta)return delta;}return a<b?-1:a>b?1:0;}).filter(([k,fields])=>!after||timestamp?( !after||+decode({mapValue:{fields}}).timestamp>afterTime||+decode({mapValue:{fields}}).timestamp===afterTime&&k>after):k>after).slice(0,q.limit);
   this.queryRows=(this.queryRows||0)+rows.length;return Response.json(rows.map(([k,fields])=>({document:{name:'projects/demo/databases/(default)/documents/'+k,fields}})));
  }
  if(suffix===':commit'){
   for(const w of body.writes)if(w.currentDocument?.exists===false&&this.docs.has(w.update.name.split('/documents/')[1]))return Response.json({error:{status:'ALREADY_EXISTS'}},{status:409});
   for(const w of body.writes){const key=(w.update?.name||w.delete).split('/documents/')[1];if(w.delete)this.docs.delete(key);else this.docs.set(key,w.update.fields);}
   return Response.json({});
  }
  const fields=this.docs.get(suffix.slice(1));return fields?Response.json({fields}):Response.json({error:{status:'NOT_FOUND'}},{status:404});
 }
 get(path){return this.docs.has(path)?decode({mapValue:{fields:this.docs.get(path)}}):null;}
 put(path,value){this.docs.set(path,encode(value).mapValue.fields);}
}
