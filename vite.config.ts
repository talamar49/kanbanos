import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'electron/**/*.test.ts'],
    css: false,
    // Keep interaction-heavy jsdom suites responsive instead of letting worker contention trip per-test timeouts.
    maxWorkers: 4,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,tsx}', 'electron/{attachment-preview,git-service}.ts'],
      exclude: ['src/main.tsx', 'src/vite-env.d.ts', 'src/domain/types.ts', 'src/test/**', 'src/**/*.test.{ts,tsx}'],
      thresholds: {
        statements: 50,
        branches: 40,
        functions: 45,
        lines: 55,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
