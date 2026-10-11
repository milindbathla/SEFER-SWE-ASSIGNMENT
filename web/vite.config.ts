import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The API runs on :3001 (npm run dev starts both). No secrets or env values are exposed to the bundle.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:3001' } },
  envPrefix: 'SEFER_PUBLIC_',
});
