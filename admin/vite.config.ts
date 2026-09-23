import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const root = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(root, '../app')
const appSrc = path.join(appRoot, 'src')
const appModules = path.join(appRoot, 'node_modules')

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@ra/ui': path.join(appSrc, 'ui'),
      '@ra/theme': path.join(appSrc, 'theme'),
      react: path.join(appModules, 'react'),
      'react-dom': path.join(appModules, 'react-dom'),
      'react/jsx-runtime': path.join(appModules, 'react/jsx-runtime'),
      // Single router instance so AppShell useNavigate sees BrowserRouter context
      'react-router-dom': path.join(appModules, 'react-router-dom'),
      'lucide-react': path.join(appModules, 'lucide-react'),
      motion: path.join(appModules, 'motion'),
      clsx: path.join(appModules, 'clsx'),
    },
    dedupe: ['react', 'react-dom', 'react-router', 'react-router-dom', 'lucide-react', 'motion'],
  },
  server: {
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
