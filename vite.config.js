import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
})
