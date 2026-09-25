import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5173 },
  preview: { port: 4173 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    hookTimeout: 60000,
    testTimeout: 60000,
  },
} as any);
