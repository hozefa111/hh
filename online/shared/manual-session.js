(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ManualSessionGuard=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const active=(id,row)=>!!row&&row.source!=='online'&&!String(id).startsWith('cf2_')&&row.endTime==null&&!['stopped','deleted','deleting'].includes(row.status);
 function next(pointer,changes){
  let current=pointer.sessionId||null;const latest=new Map(changes.map(c=>[c.id,c]));
  if(current&&latest.has(current)&&!active(current,latest.get(current).after))current=null;
  for(const [id,c]of latest)if(active(id,c.after)){if(current&&current!==id)throw Error('A manual session is already active. Refresh before starting another.');current=id;}
  return {sessionId:current};
 }
 return {active,next};
});
