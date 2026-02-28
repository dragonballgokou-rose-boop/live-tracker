const isCapacitor = process.env.BUILD_TARGET === 'capacitor';

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
  }
}
