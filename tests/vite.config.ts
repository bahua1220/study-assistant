import { defineConfig } from 'vite'
import base from '../vite.config'

// E2E only: avoid scanning Android/Gradle/deployment artifacts and live reloads
// while packaging the app. Production and normal development config are unchanged.
export default defineConfig({
  ...base,
  server: { ...base.server, watch: null, hmr: false },
})
