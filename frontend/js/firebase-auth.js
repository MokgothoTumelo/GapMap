import { getFirebaseServices } from './firebase-app.js';

function mapAuthError(error) {
  const code = String(error?.code || '');
  switch (code) {
    case 'auth/email-already-in-use': return 'An account with this email already exists. Please log in instead.';
    case 'auth/invalid-email': return 'Please enter a valid email address.';
    case 'auth/weak-password': return 'Password must be at least 6 characters.';
    case 'auth/user-not-found': return 'No GapMap account was found for this email. Please create an account first.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password': return 'We could not sign you in with those details. Check your email and password, or create a GapMap account if you have not registered yet.';
    case 'auth/too-many-requests': return 'Too many sign-in attempts. Please wait and try again.';
    case 'auth/network-request-failed': return 'Firebase could not reach the network. Check your connection and try again.';
    case 'auth/operation-not-allowed': return 'Email/password sign-in is not enabled in the Firebase Console yet.';
    default: return error?.message || 'Firebase Authentication could not complete the request.';
  }
}

export async function signUpWithPassword(email, password) {
  try {
    const { auth, firebase } = await getFirebaseServices();
    const credential = await firebase.createUserWithEmailAndPassword(auth, email, password);
    return credential.user;
  } catch (error) {
    const wrapped = new Error(mapAuthError(error));
    wrapped.code = error?.code;
    wrapped.cause = error;
    throw wrapped;
  }
}

export async function signInWithPassword(email, password) {
  try {
    const { auth, firebase } = await getFirebaseServices();
    const credential = await firebase.signInWithEmailAndPassword(auth, email, password);
    return credential.user;
  } catch (error) {
    const wrapped = new Error(mapAuthError(error));
    wrapped.code = error?.code;
    wrapped.cause = error;
    throw wrapped;
  }
}

export async function updateDisplayName(displayName) {
  const { auth, firebase } = await getFirebaseServices();
  if (!auth.currentUser) throw new Error('No Firebase account is signed in.');
  await firebase.updateProfile(auth.currentUser, { displayName: displayName || '' });
  return auth.currentUser;
}

export async function changePassword(currentPassword, newPassword) {
  try {
    const { auth, firebase } = await getFirebaseServices();
    const currentUser = auth.currentUser;
    if (!currentUser?.email) throw new Error('Please sign in again before changing your password.');
    const credential = firebase.EmailAuthProvider.credential(currentUser.email, currentPassword);
    await firebase.reauthenticateWithCredential(currentUser, credential);
    await firebase.updatePassword(currentUser, newPassword);
  } catch (error) {
    if (error?.code === 'auth/invalid-credential' || error?.code === 'auth/wrong-password') {
      throw new Error('Your current password is incorrect.');
    }
    throw new Error(mapAuthError(error));
  }
}

export async function sendFirebasePasswordResetEmail(email) {
  try {
    const { auth, firebase } = await getFirebaseServices();
    await firebase.sendPasswordResetEmail(auth, email);
  } catch (error) {
    throw new Error(mapAuthError(error));
  }
}

export async function signOutFirebase() {
  try {
    const { auth, firebase } = await getFirebaseServices();
    await firebase.signOut(auth);
  } catch (error) {
    console.warn('[Firebase Auth] signOut failed.', error);
  }
}
