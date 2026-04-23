// =============================================
// 3 PATTI PRO — Firebase Configuration
// =============================================
//
// FIRESTORE SECURITY RULES (set in Firebase Console → Firestore → Rules):
// -----------------------------------------------------------------------
// rules_version = '2';
// service cloud.firestore {
//   match /databases/{database}/documents {
//     match /{document=**} {
//       allow read: if true;
//       allow write: if request.auth != null;
//     }
//   }
// }
// -----------------------------------------------------------------------
//
// Admin: admin@gmail.com / 12345678

const firebaseConfig = {
    apiKey: "AIzaSyA9bcA9caD4xmbW-jo9NXC7A66MUBZQbIg",
    authDomain: "patti-pro-a61d8.firebaseapp.com",
    projectId: "patti-pro-a61d8",
    storageBucket: "patti-pro-a61d8.firebasestorage.app",
    messagingSenderId: "570573461138",
    appId: "1:570573461138:web:4414d0ce87282b91b2f84b",
    measurementId: "G-RM47MXWMG8"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Firestore & Auth references (used by app.js)
const db = firebase.firestore();
const auth = firebase.auth();

// Analytics (optional, non-blocking)
try {
    if (firebase.analytics) {
        firebase.analytics();
    }
} catch (e) {
    console.warn('Analytics not available:', e.message);
}

// Enable offline persistence for Firestore
db.enablePersistence({ synchronizeTabs: true }).catch(err => {
    if (err.code === 'failed-precondition') {
        console.warn('Firestore persistence failed: multiple tabs open');
    } else if (err.code === 'unimplemented') {
        console.warn('Firestore persistence not supported in this browser');
    }
});

console.log('🔥 Firebase initialized for 3 Patti PRO (patti-pro-a61d8)');

// --- ADDED FOR NOTIFICATIONS ---
// Dynamically load Firebase Messaging Compat SDK since index.html is locked
const msgScript = document.createElement('script');
msgScript.src = "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js";
document.body.appendChild(msgScript);

window.VAPID_KEY = "BMok8jsI_GYiyLkU4CJzMPTSo7IARqREdA5rOZbp3rIUTneXvZxFOJ4uYZ7nheTIBYDSksEZXHIU2GA4kykyUOA";

/*
  FIRESTORE SECURITY RULES - ADDED:
  match /fcmTokens/{tokenId} {
    allow read: if isAdmin();
    allow write: if true;
  }
  match /pendingNotifications/{docId} {
    allow read, write: if isAdmin();
  }
*/

const notifScript = document.createElement('script');
notifScript.src = 'notifications.js';
document.body.appendChild(notifScript);
