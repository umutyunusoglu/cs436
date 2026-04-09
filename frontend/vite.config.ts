import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      // Proxy /api calls to the ALB in dev so you don't need CORS setup locally
      '/prices': { target: process.env.VITE_API_URL ?? 'http://localhost:8080', changeOrigin: true },
      '/predict': { target: process.env.VITE_API_URL ?? 'http://localhost:8080', changeOrigin: true },
      '/technical': { target: process.env.VITE_API_URL ?? 'http://localhost:8080', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          charts: ['lightweight-charts'],
        },
      },
    },
  },
});
