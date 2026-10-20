// Cache only public same-origin assets. Online/private network traffic is never cached.
const CACHE_NAME='patti-pro-online-v1';
self.addEventListener('install',e=>{self.skipWaiting();});
self.addEventListener('activate',e=>e.waitUntil((async()=>{for(const key of await caches.keys())if(key!==CACHE_NAME)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('fetch',e=>{
 const u=new URL(e.request.url);
 if(e.request.method!=='GET'||u.origin!==self.location.origin||!(/\.(css|js|png|svg|woff2)$/.test(u.pathname)||u.pathname.endsWith('.html')))return;
 e.respondWith((async()=>{const cache=await caches.open(CACHE_NAME);try{const r=await fetch(e.request);if(r.ok)await cache.put(e.request,r.clone());return r;}catch(error){const stored=await cache.match(e.request);if(stored)return stored;throw error;}})());
});

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

const firebaseAppForMessaging = firebase.initializeApp({
  apiKey: "AIzaSyA9bcA9caD4xmbW-jo9NXC7A66MUBZQbIg",
  authDomain: "patti-pro-a61d8.firebaseapp.com",
  projectId: "patti-pro-a61d8",
  messagingSenderId: "570573461138",
  appId: "1:570573461138:web:4414d0ce87282b91b2f84b"
}, 'messaging-app');

const messagingInstance = firebaseAppForMessaging.messaging();
messagingInstance.onBackgroundMessage(payload => {
  self.registration.showNotification(
    payload.notification.title, {
      body: payload.notification.body,
      icon: '/icon-192.png'
    }
  );
});
