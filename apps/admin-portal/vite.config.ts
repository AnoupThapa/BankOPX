import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Same-origin proxy keeps the staff session cookie HttpOnly + SameSite=Strict in development.
const api = process.env.API_URL ?? 'http://127.0.0.1:3100';
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, proxy: { '/auth': api, '/config': api } },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test-setup.ts'] },
});
