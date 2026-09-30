import { createRouter, createWebHashHistory } from 'vue-router';
import { adminAccessToken, useAuthSession } from '../composables/useAuthSession.js';
import {
  canEnterRoute,
  LEGACY_MODE_ROUTES,
  legacyAdminRedirect,
} from './policy.js';

// App.vue remains the transitional view host because it owns state and event
// handlers currently required by every page. Routes drive URL/history and
// access policy without detaching those existing page props.
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/login' },
    ...LEGACY_MODE_ROUTES.map(({ path, mode, requiresAdmin, requiresFamily, hidePrimaryNav }) => ({
      path,
      // This compatibility phase deliberately has no RouterView. The root
      // App.vue renders the selected legacy page with its existing state/props.
      meta: {
        legacyMode: mode,
        requiresAdmin: Boolean(requiresAdmin),
        requiresFamily: Boolean(requiresFamily),
        hidePrimaryNav: Boolean(hidePrimaryNav),
      },
    })),
    { path: '/admin', redirect: () => legacyAdminRedirect('/admin') },
    { path: '/:pathMatch(.*)*', redirect: '/login' },
  ],
});

const { getCurrentRole } = useAuthSession();

router.beforeEach((to) => {
  const legacyTarget = legacyAdminRedirect(to.path);
  if (legacyTarget) return legacyTarget;
  if (canEnterRoute(to.meta, adminAccessToken.value, getCurrentRole())) return true;
  return to.meta.requiresAdmin ? '/admin/login' : '/login';
});
