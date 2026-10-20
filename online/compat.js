/* Compatibility for Android System WebView shipped with older supported devices. */
if(!Array.prototype.at)Object.defineProperty(Array.prototype,'at',{value:function(i){i=Math.trunc(i)||0;if(i<0)i+=this.length;return this[i];},configurable:true,writable:true});
if(!Array.prototype.flatMap)Object.defineProperty(Array.prototype,'flatMap',{value:function(fn){return Array.prototype.concat.apply([],this.map(fn));},configurable:true,writable:true});
if(!Object.fromEntries)Object.fromEntries=function(entries){const out={};for(const pair of entries)Object.defineProperty(out,pair[0],{value:pair[1],enumerable:true,writable:true,configurable:true});return out;};
if(!crypto.randomUUID)crypto.randomUUID=function(){const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const s=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');return s.slice(0,8)+'-'+s.slice(8,12)+'-'+s.slice(12,16)+'-'+s.slice(16,20)+'-'+s.slice(20);};
