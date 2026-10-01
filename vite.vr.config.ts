import basicSsl from '@vitejs/plugin-basic-ssl';
import { mergeConfig } from 'vite';
import baseConfig from './vite.config';

// Para Meta Quest y otros dispositivos de la LAN, que exigen HTTPS fuera de
// localhost. En la PC, `npm run dev` usa HTTP y evita los avisos del certificado
// autofirmado de desarrollo.
export default mergeConfig(baseConfig, {
  plugins: [basicSsl()],
  // Evitar que Meta Quest Browser conserve módulos viejos entre sesiones XR.
  server: { host: true, port: 5182, headers: { 'Cache-Control': 'no-store' } },
});
