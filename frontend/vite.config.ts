import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Phase 0: dev proxy only. No business routes wired yet.
// API (REST) and WebSocket are forwarded to the NestJS backend during development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
