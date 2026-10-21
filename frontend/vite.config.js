import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En desarrollo, el frontend llama a "/api/..." y Vite lo reenvía a Orders API.
// Así el navegador siempre habla con un solo origen y no hay problemas de CORS.
// En Docker, nginx hará este mismo trabajo (etapa 6).
const apiTarget = process.env.API_PROXY_TARGET || 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
