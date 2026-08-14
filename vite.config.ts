// vitest's defineConfig, not vite's — the plain one has no `test` key in its
// types, so the build fails on the exclude list below.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  test: {
    // Agent worktrees are created inside the repo at .claude/worktrees, and
    // vitest's default glob happily recurses into them — which silently runs
    // another branch's tests as part of this one's gate, and reports failures
    // against code that is not checked out here. The gate has to describe this
    // working tree and nothing else.
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 700,
  },
});
