const isCapacitor = process.env.BUILD_TARGET === 'capacitor';
const BUILD_ID = (process.env.GITHUB_SHA || 'local').slice(0, 7) + '-' + new Date().toISOString().slice(0, 16).replace('T', '_');

export default {
  root: '.',
  publicDir: 'public',
  base: isCapacitor ? '/' : '/live-tracker/',
  server: {
    port: 5173,
    host: true
  },
  build: {
    outDir: 'dist'
  },
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
}
