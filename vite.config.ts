import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import { openAiProxyPlugin } from './server/openai-proxy.ts'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [vue(), openAiProxyPlugin({
      baseUrl: env.OPENAI_BASE_URL ?? '',
      apiKey: env.OPENAI_API_KEY ?? '',
      model: env.OPENAI_MODEL ?? '',
      reasoningEffort: env.OPENAI_REASONING_EFFORT ?? 'low'
    })],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    optimizeDeps: { entries: ['index.html'] },
    server: {
      proxy: {
        '/backend-api': {
          target: env.BACKEND_ORIGIN ?? 'http://127.0.0.1:8000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/backend-api/, '')
        }
      }
    },
    test: { environment: 'jsdom', globals: true, exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'] }
  }
})
