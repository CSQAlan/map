import { createRouter, createWebHashHistory } from 'vue-router';
import { adminAccessToken, useAuthSession } from '../composables/useAuthSession.js';
import {
  canEnterRoute,
  legacyAdminRedirect,
} from './policy.js';
import { appRoutes } from './routes.js';

// App.vue remains the transitional view host because it owns state and event
// handlers currently required by every page. Routes drive URL/history and
// access policy without detaching those existing page props.
export const router = createRouter({
  history: createWebHashHistory(),
  routes: appRoutes,
});

const { getCurrentRole } = useAuthSession();

router.beforeEach((to) => {
  const legacyTarget = legacyAdminRedirect(to.path);
  if (legacyTarget) return legacyTarget;
  if (canEnterRoute(to.meta, adminAccessToken.value, getCurrentRole())) return true;
  return to.meta.requiresAdmin ? '/admin/login' : '/login';
});
