// Request permission and save token
window.requestNotificationPermission = async function() {
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      const messaging = firebase.messaging();
      const token = await messaging.getToken({ vapidKey: window.VAPID_KEY });
      if (token) {
        await firebase.firestore().collection('fcmTokens').add({
          token: token,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log("Notification token saved!");
      }
    }
  } catch (error) {
    console.error('Notification permission error:', error);
  }
};

// Send notification when round is saved
window.sendRoundNotification = async function(hukumName, result, bid) {
  try {
    await firebase.firestore().collection('pendingNotifications').add({
      title: "3 Patti PRO 🎴",
      body: `New Round! Hukum: ${hukumName} — ${result} • Bid: ${bid}`,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      sent: false
    });
  } catch (error) {
    console.error('Send notification error:', error);
  }
};
