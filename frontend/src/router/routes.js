import { LEGACY_MODE_ROUTES, legacyAdminRedirect } from './policy.js';

// App.vue is the transitional view host. Marker components keep these paths in
// Vue Router's matcher without asking RouterView to render a second page tree.
const RouteMarker = { render: () => null };

export const appRoutes = [
  { path: '/', redirect: '/login' },
  ...LEGACY_MODE_ROUTES.map(({ path, mode, requiresAdmin, requiresFamily, hidePrimaryNav }) => ({
    path,
    component: RouteMarker,
    meta: {
      legacyMode: mode,
      requiresAdmin: Boolean(requiresAdmin),
      requiresFamily: Boolean(requiresFamily),
      hidePrimaryNav: Boolean(hidePrimaryNav),
    },
  })),
  { path: '/admin', redirect: () => legacyAdminRedirect('/admin') },
  { path: '/:pathMatch(.*)*', redirect: '/login' },
];
