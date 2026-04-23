const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

exports.sendRoundNotification = functions.firestore
  .document('pendingNotifications/{docId}')
  .onCreate(async (snap) => {
    try {
      const data = snap.data();
      const tokensSnap = await admin.firestore()
        .collection('fcmTokens').get();
      const tokens = tokensSnap.docs.map(d => d.data().token);
      if (tokens.length === 0) return null;
      await admin.messaging().sendEachForMulticast({
        tokens,
        notification: {
          title: data.title,
          body: data.body
        },
        webpush: {
          notification: {
            icon: '/icon-192.png',
            click_action: '/'
          }
        }
      });
      await snap.ref.update({ sent: true });
      return null;
    } catch (error) {
      console.error('Cloud function error:', error);
      return null;
    }
  });
