import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// In dev the portal and API share an origin through this proxy, so the session cookie stays HttpOnly + SameSite=Strict.
const api = process.env.API_URL ?? 'http://127.0.0.1:3100';
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/customer': api, '/catalogue': api, '/auth': api } },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test-setup.ts'] },
});
