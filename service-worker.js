const CACHE_NAME = 'patti-pro-v1';
const urlsToCache = ['/', '/index.html'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME)
    .then(cache => cache.addAll(urlsToCache)));
});
self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request)
    .then(response => response || fetch(e.request)));
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
