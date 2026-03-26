import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'

export default defineConfig(function () {
  var shouldAnalyze = String(process.env.BUNDLE_ANALYZE || '').toLowerCase() === 'true'

  return {
    plugins: [
      react(),
      shouldAnalyze
        ? visualizer({
            filename: 'dist/bundle-analysis.html',
            template: 'treemap',
            gzipSize: true,
            brotliSize: true,
            open: false,
          })
        : null,
    ].filter(Boolean),
    build: {
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom'],
            sentry: ['@sentry/react', '@sentry/node'],
            supabase: ['@supabase/supabase-js'],
            charts: ['recharts'],
            xlsx: ['xlsx'],
          },
        },
      },
    },
  }
})
