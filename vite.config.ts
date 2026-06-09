import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { devApi } from './vite-dev-api';

export default defineConfig({
  plugins: [react(), devApi()],
  server: { port: 5173 },
});
