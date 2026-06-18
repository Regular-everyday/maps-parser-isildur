import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

const firebaseConfig = {
  projectId: 'maps-parser-isildur',
  appId: '1:554550642261:web:965ee6b9341e06560136dc',
  storageBucket: 'maps-parser-isildur.firebasestorage.app',
  apiKey: 'AIzaSyAIknDftSynjjFsNp8sTCqaK9sjsRx4p5c',
  authDomain: 'maps-parser-isildur.firebaseapp.com',
  messagingSenderId: '554550642261',
  measurementId: 'G-QE2VMYCH5L'
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, 'maps-parser');
export const functions = getFunctions(app, 'europe-west3');

if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}
