// Public endpoint only; never put credentials in the client configuration.
const fs=require('node:fs'),path=require('node:path');
const base=new URL(process.argv[2]||'');
if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||base.pathname!=='/'||!base.hostname.endsWith('.workers.dev'))throw Error('Supply the actual deployed https://<worker>.<account>.workers.dev/ origin');
const file=path.resolve(__dirname,'../../online/config.js'),source=fs.readFileSync(file,'utf8');
if(!/window\.KALI_API_BASE='[^']*';/.test(source))throw Error('Expected endpoint configuration missing');
fs.writeFileSync(file,source.replace(/window\.KALI_API_BASE='[^']*';/,"window.KALI_API_BASE='"+base.href+"';"));
console.log('Configured public backend origin; now run npm run sync:android and rebuild/test.');
