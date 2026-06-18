import { defineConfig } from 'vite';

export default defineConfig({
  // Relative assets work on both <username>.github.io/<repository>/ and local preview.
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/functions']
        }
      }
    }
  }
});
