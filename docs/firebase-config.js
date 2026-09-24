// firebase-config.js
/*const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);*/

// Initialize services
const auth = firebase.auth();
const db = firebase.firestore();

// Enable offline persistence (great for mobile)
db.enablePersistence()
    .catch((err) => {
        console.error('Firestore persistence error:', err);
    });

// Collection references
const usersCollection = db.collection('users');
const preferencesCollection = db.collection('preferences');
const diagnosticsCollection = db.collection('diagnostics');
const conceptScoresCollection = db.collection('conceptScores');
const practiceHistoryCollection = db.collection('practiceHistory');
const learningProgressCollection = db.collection('learningProgress');

// Helper functions
function getCurrentUser() {
    return auth.currentUser;
}

function getUserDocRef(userId) {
    return usersCollection.doc(userId);
}

function getPreferencesRef(userId) {
    return preferencesCollection.doc(userId);
}

function getDiagnosticsRef(userId) {
    return diagnosticsCollection.doc(userId);
}

// Export for use in other files
window.firebaseApp = firebase;
window.auth = auth;
window.db = db;
window.usersCollection = usersCollection;
window.preferencesCollection = preferencesCollection;
window.diagnosticsCollection = diagnosticsCollection;
window.conceptScoresCollection = conceptScoresCollection;
window.practiceHistoryCollection = practiceHistoryCollection;
window.learningProgressCollection = learningProgressCollection;
window.getCurrentUser = getCurrentUser;
window.getUserDocRef = getUserDocRef;
window.getPreferencesRef = getPreferencesRef;
window.getDiagnosticsRef = getDiagnosticsRef;
