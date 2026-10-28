import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryHistory, createRouter } from 'vue-router';
import {
  LEGACY_MODE_ROUTES,
  canEnterRoute,
  legacyAdminRedirect,
  pathForLegacyMode,
} from '../src/router/policy.js';
import { appRoutes } from '../src/router/routes.js';

test('legacy admin URL redirects to the login page', () => {
  assert.equal(legacyAdminRedirect('/admin'), '/admin/login');
  assert.equal(legacyAdminRedirect('/admin/overview'), null);
});

test('admin routes require an admin token while public routes remain accessible', () => {
  assert.equal(canEnterRoute({ requiresAdmin: true }, ''), false);
  assert.equal(canEnterRoute({ requiresAdmin: true }, 'signed-token'), true);
  assert.equal(canEnterRoute({}, ''), true);
});

test('family routes require a restored family role', () => {
  assert.equal(canEnterRoute({ requiresFamily: true }, '', null), false);
  assert.equal(canEnterRoute({ requiresFamily: true }, '', 'elder'), false);
  assert.equal(canEnterRoute({ requiresFamily: true }, '', 'family'), true);
});

test('every existing App mode has a stable hash route', () => {
  const modes = [
    'login', 'guest-profile', 'elder', 'route-options', 'recommend', 'navigation',
    'assistant', 'survey-records', 'profile', 'family', 'family-binding',
    'admin-login', 'admin', 'admin-collect', 'admin-survey',
  ];
  assert.deepEqual(LEGACY_MODE_ROUTES.map(({ mode }) => mode), modes);
  assert.equal(pathForLegacyMode('admin-collect'), '/admin/collect');
  assert.equal(pathForLegacyMode('route-options'), '/elder/routes');
  assert.equal(pathForLegacyMode('not-a-mode'), null);
});

test('login and legacy routes are registered instead of falling through to the catch-all', async () => {
  const router = createRouter({ history: createMemoryHistory(), routes: appRoutes });

  await router.push('/login');

  assert.equal(router.currentRoute.value.path, '/login');
  assert.equal(router.currentRoute.value.meta.legacyMode, 'login');
  assert.equal(router.currentRoute.value.matched.at(-1).path, '/login');
  assert.ok(router.resolve('/elder/home').matched.some(({ path }) => path === '/elder/home'));
});
