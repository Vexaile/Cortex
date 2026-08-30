import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Most suites are pure and finish in milliseconds. test/arduinoShim.test.ts
    // spawns a real g++ per case, which is seconds cold and much worse when
    // several compile at once, so the default 5s would fail on a slow machine
    // rather than on a real defect.
    testTimeout: 120_000
  }
})
