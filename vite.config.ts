import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: {
    host: true, // expone en la LAN para probar desde el visor
    port: 5173,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 2048,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      // El paquete principal supera 1 MB; sin subir este techo el service
      // worker lo dejaría fuera del caché y la promesa de "funciona sin
      // conexión" sería falsa justo para el archivo que más importa.
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,svg,png,webmanifest}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      manifest: {
        name: 'Ciudad 2050',
        short_name: 'Ciudad 2050',
        description: 'Ciudad solarpunk generada por código, recorrible a pie y en realidad virtual.',
        lang: 'es',
        start_url: '/',
        display: 'fullscreen',
        orientation: 'landscape',
        background_color: '#0d1b18',
        theme_color: '#0d1b18',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});
