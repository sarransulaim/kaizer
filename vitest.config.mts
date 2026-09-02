import { resolve } from 'node:path'

import { defineConfig } from 'vitest/config'

/**
 * Unit tests for the logic that handles money, hours and order state.
 *
 * These are the functions where a mistake is expensive rather than merely
 * visible: a rounding error in `payCents` underpays someone every week, and a
 * hole in the status machine lets an order skip a step on the board. They are
 * all pure, so they need no database and run in milliseconds.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      /* Import guard for server modules; irrelevant under test. */
      'server-only': resolve(__dirname, './test/stubs/server-only.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
