(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.PattiSession=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 function includes(round,session){if(round.sessionId)return round.sessionId===session.id;if(round.source==='online'||session.source==='online')return false;const t=+new Date(round.timestamp),start=+new Date(session.startTime),end=session.endTime?+new Date(session.endTime):Infinity;return t>=start&&t<=end;}
 return {includes};
});
