import test from 'node:test';
import assert from 'node:assert/strict';
import { canRegisterServiceWorker, joinPublicPath } from '../src/pwa.js';

test('joins public paths against Vite base URLs', () => {
  assert.equal(joinPublicPath('/', 'sw.js'), '/sw.js');
  assert.equal(joinPublicPath('/memories', 'sw.js'), '/memories/sw.js');
  assert.equal(joinPublicPath('/memories/', '/manifest.webmanifest'), '/memories/manifest.webmanifest');
});

test('allows service worker registration only in secure or local contexts', () => {
  assert.equal(
    canRegisterServiceWorker({
      navigatorObject: { serviceWorker: {} },
      locationObject: { protocol: 'https:', hostname: 'example.com' },
    }),
    true,
  );
  assert.equal(
    canRegisterServiceWorker({
      navigatorObject: { serviceWorker: {} },
      locationObject: { protocol: 'http:', hostname: '127.0.0.1' },
    }),
    true,
  );
  assert.equal(
    canRegisterServiceWorker({
      navigatorObject: { serviceWorker: {} },
      locationObject: { protocol: 'http:', hostname: 'example.com' },
    }),
    false,
  );
});
