import { resolve } from 'path'
import { config as dotenvConfig } from 'dotenv'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// Load environment variables from .env file
dotenvConfig({ path: resolve(__dirname, '.env'), override: true })

// Shared alias configuration
const aliases = {
  '@/app': resolve(__dirname, 'app'),
  '@/lib': resolve(__dirname, 'lib'),
  '@/resources': resolve(__dirname, 'resources'),
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'lib/main/main.ts'),
        },
      },
    },
    define: {
      // Bake environment variables into the main process at build time.
      // In production, .env is excluded from the asar bundle so dotenv.config()
      // finds nothing at runtime. These defines ensure the values are inlined.
      'process.env.BACKEND_URL': JSON.stringify(process.env.BACKEND_URL || ''),
      'process.env.ANTHROPIC_BASE_URL': JSON.stringify(process.env.ANTHROPIC_BASE_URL || ''),
      'process.env.ANTHROPIC_API_KEY': JSON.stringify(process.env.ANTHROPIC_API_KEY || ''),
    },
    resolve: {
      alias: aliases,
    },
    plugins: [
      externalizeDepsPlugin({
        // Bundle ESM-only packages since Electron main uses CJS
        exclude: [
          '@openai/codex-sdk',
          '@anthropic-ai/claude-agent-sdk',
          '@electron-toolkit/utils',
          'stripe',
        ],
      }),
    ],
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          preload: resolve(__dirname, 'lib/preload/preload.ts'),
        },
      },
    },
    resolve: {
      alias: aliases,
    },
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: './app',
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'app/index.html'),
        },
      },
    },
    resolve: {
      alias: aliases,
    },
    plugins: [
      tailwindcss(),
      react(),
      nodePolyfills({
        // Include specific Node.js built-ins for browser compatibility
        include: ['buffer', 'process'],
        globals: {
          Buffer: true,
          global: true,
          process: true,
        },
      }),
    ],
  },
})
