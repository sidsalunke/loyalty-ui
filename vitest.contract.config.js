import { defineConfig } from 'vitest/config'

/**
 * Separate Vitest config for Pact consumer contract tests.
 *
 * Runs in a Node environment (not jsdom) because Pact spins up a local
 * HTTP mock server that the test code calls directly — no browser needed.
 *
 * Generated pact files land in pacts/ and should be committed to this repo.
 * The mediation-service BE CI workflow checks out this repo to run
 * provider verification against those committed files.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/contract/**/*.test.js'],
    testTimeout: 30_000,
    // Run contract tests serially — each Pact test spins up its own
    // mock server on a unique port, but running them in parallel can
    // cause port conflicts on resource-constrained CI runners.
    pool: 'forks',
    singleFork: true
  }
})
