import {createRemoteJWKSet,jwtVerify,importPKCS8,SignJWT} from 'jose';
const keys=createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
export class Identity {
 constructor(env,fetcher=(...args)=>fetch(...args)){this.env=env;this.fetcher=fetcher;this.cached=null;}
 async credential(){
  if(!this.accountReady)this.accountReady=(async()=>{const account=JSON.parse(this.env.FIREBASE_SERVICE_ACCOUNT);if(account.project_id!==this.env.FIREBASE_PROJECT_ID)throw Error('Credential project mismatch');const key=await importPKCS8(account.private_key,'RS256');this.account=account;this.key=key;return account;})();
  try{return await this.accountReady;}catch(e){this.accountReady=null;throw e;}
 }
 async token(){
  if(this.cached&&this.cached.until>Date.now()+60000)return this.cached.token;
  if(this.refreshing)return this.refreshing;
  this.refreshing=this.refreshToken();try{return await this.refreshing;}finally{this.refreshing=null;}
 }
 async refreshToken(){
  if(this.cached&&this.cached.until>Date.now()+60000)return this.cached.token;
  const a=await this.credential(),assertion=await new SignJWT({scope:'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/identitytoolkit'}).setProtectedHeader({alg:'RS256'}).setIssuer(a.client_email).setAudience('https://oauth2.googleapis.com/token').setIssuedAt().setExpirationTime('1h').sign(this.key);
  const res=await this.fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(10000)}),v=await res.json();
  if(!res.ok)throw Error('Server credential unavailable');this.cached={token:v.access_token,until:Date.now()+v.expires_in*1000};return v.access_token;
 }
 async verify(token){
  const project=this.env.FIREBASE_PROJECT_ID,{payload:p}=await jwtVerify(token,keys,{issuer:'https://securetoken.google.com/'+project,audience:project,algorithms:['RS256']});
  if(!p.sub||p.sub.length>128||p.user_id!==p.sub||!Number.isFinite(p.auth_time))throw Error('Invalid identity');
  // Verify disable/revocation on the server, just as Firebase verifyIdToken(..., true).
  const response=await this.fetcher(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:lookup`,{method:'POST',headers:{Authorization:'Bearer '+await this.token(),'Content-Type':'application/json'},body:JSON.stringify({localId:[p.sub]}),signal:AbortSignal.timeout(10000)});
  const value=await response.json(),account=value.users?.[0];if(!response.ok||!account||account.localId!==p.sub||account.disabled||Number(account.validSince||0)>p.auth_time)throw Error('Sign in again');
  return {uid:p.sub,admin:p.admin===true};
 }
 async customToken(uid){const a=await this.credential();return new SignJWT({uid}).setProtectedHeader({alg:'RS256'}).setIssuer(a.client_email).setSubject(a.client_email).setAudience('https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit').setIssuedAt().setExpirationTime('1h').sign(this.key);}
}
