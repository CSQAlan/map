export const LEGACY_MODE_ROUTES = [
  { path: '/login', mode: 'login' },
  { path: '/guest/profile', mode: 'guest-profile' },
  { path: '/elder/home', mode: 'elder' },
  { path: '/elder/plan', mode: 'recommend' },
  { path: '/elder/navigation', mode: 'navigation', hidePrimaryNav: true },
  { path: '/elder/survey', mode: 'survey-records' },
  { path: '/elder/profile', mode: 'profile' },
  { path: '/family/dashboard', mode: 'family', requiresFamily: true },
  { path: '/family/binding', mode: 'family-binding', requiresFamily: true },
  { path: '/admin/login', mode: 'admin-login' },
  { path: '/admin/overview', mode: 'admin', requiresAdmin: true },
  { path: '/admin/collect', mode: 'admin-collect', requiresAdmin: true },
  { path: '/admin/survey-placement', mode: 'admin-survey', requiresAdmin: true },
];

export function legacyAdminRedirect(path) {
  return path === '/admin' ? '/admin/login' : null;
}

export function canEnterRoute(meta, adminToken, currentRole) {
  if (meta.requiresAdmin && !adminToken) return false;
  if (meta.requiresFamily && currentRole !== 'family') return false;
  return true;
}

export function pathForLegacyMode(mode) {
  return LEGACY_MODE_ROUTES.find((route) => route.mode === mode)?.path ?? null;
}
