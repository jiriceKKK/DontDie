// Playwright configuration.
//
// The suite runs against the local no-cache dev server with a fake Supabase
// client injected before app code. It never contacts the production project:
// tests/e2e/fixtures/seed.js both replaces window.supabase and aborts any
// request to *.supabase.co.
import { defineConfig, devices } from '@playwright/test';

const PORT = 8123;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    // Deterministic: nothing outside the local server should ever be needed.
    offline: false,
    // The service worker is network-first and its requests bypass page.route,
    // which would let the real Supabase library load on a reload and defeat the
    // fake. Offline/app-shell behaviour is Phase 8 work and is tested there.
    serviceWorkers: 'block',
  },

  // The two viewports plan.md requires evidence at, plus a third project that
  // exists purely so the gesture-performance measurements are not competing
  // with the rest of the suite for CPU. It depends on both viewport projects,
  // so it runs last and effectively alone, and it never runs in parallel with
  // itself — a long-task budget measured against a saturated machine would be
  // noise rather than evidence.
  projects: [
    {
      name: 'mobile-390x844',
      testIgnore: '**/swipe-performance.spec.js',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'desktop-1280x900',
      testIgnore: '**/swipe-performance.spec.js',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      name: 'gesture-performance',
      testMatch: '**/swipe-performance.spec.js',
      fullyParallel: false,
      dependencies: ['mobile-390x844', 'desktop-1280x900'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
  ],

  webServer: {
    command: `node scripts/dev-server.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
