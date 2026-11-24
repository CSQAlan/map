import { computed, ref } from 'vue';
import { apiRequest } from '../services/apiClient.js';
import { API_BASE_URL } from '../config/api.js';

const familySharingDenied = ref(false);
const confirmedFamilyElder = ref(null);
const familySessionKey = ref(0);
let familyRequestVersion = 0;
let familySessionVersion = 0;

function advanceFamilySession() {
  familySessionVersion += 1;
  familySessionKey.value += 1;
  confirmedFamilyElder.value = null;
}

// Persist identity/preferences only, never server binding or monitoring data.
function familyCache(user) {
  const safe = {};
  for (const key of ['id', 'role', 'phone', 'nickname', 'username', 'account', 'mobilityType', 'createdAt']) {
    if (Object.hasOwn(user, key)) safe[key] = user[key];
  }
  return { ...safe, boundElder: null, bindingStatus: null };
}

function revokeFamilySharing() {
  familySessionVersion += 1;
  confirmedFamilyElder.value = null;
  familyRequestVersion += 1;
  familySharingDenied.value = true;
  if (currentUser.value?.role === 'family') {
    currentUser.value = { ...currentUser.value, boundElder: null, bindingStatus: null };
  }
  try {
    const saved = JSON.parse(localStorage.getItem('familyMapUser') || 'null');
    if (saved) localStorage.setItem('familyMapUser', JSON.stringify(familyCache(saved)));
  } catch { /* No cached authorization may be used by the active session. */ }
}

async function familyRequest(path, body) {
  const version = ++familyRequestVersion;
  const sessionVersion = familySessionVersion;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (response.status === 403) {
    if (sessionVersion === familySessionVersion) revokeFamilySharing();
    throw new Error('家属位置共享演示未开启或访问被拒绝，手机号不是可信身份认证。');
  }
  const payload = await response.json().catch(() => ({}));
  if (version !== familyRequestVersion) throw new Error('家属操作已失效，请重新登录。');
  if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : '家属操作失败');
  familySharingDenied.value = false;
  return payload;
}

const ADMIN_TOKEN_KEY = 'adminAccessToken';
const currentUser = ref(null);
const isGuest = ref(false);
const adminAccessToken = ref(readAdminToken());
const adminUser = computed(() => adminAccessToken.value
  ? { ...(adminSession.value ?? {}), access_token: adminAccessToken.value, role: 'admin' }
  : null);
const adminSession = ref(null);

function readAdminToken() {
  try {
    return globalThis.sessionStorage?.getItem(ADMIN_TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

function persistUser(user) {
  const key = user?.role === 'family' ? 'familyMapUser' : 'elderMapUser';
  localStorage.setItem(key, JSON.stringify(user?.role === 'family' ? familyCache(user) : user));
  localStorage.setItem('mapLastLoginRole', user?.role === 'family' ? 'family' : 'elder');
}

function sanitizeLegacyUserPassword(userKey) {
  const cachedUser = localStorage.getItem(userKey);
  if (!cachedUser) return;
  try {
    const user = JSON.parse(cachedUser);
    if (!user || typeof user !== 'object' || !Object.hasOwn(user, 'password')) return;
    const { password: _legacyPassword, ...safeUser } = user;
    localStorage.setItem(userKey, JSON.stringify(safeUser));
  } catch {
    // Leave unrelated malformed cached data for the existing restore handler.
  }
}

function restoreSession() {
  advanceFamilySession();
  familyRequestVersion += 1;
  currentUser.value = null;
  isGuest.value = false;
  sanitizeLegacyUserPassword('elderMapUser');
  sanitizeLegacyUserPassword('familyMapUser');
  const cachedFamily = localStorage.getItem('familyMapUser');
  if (cachedFamily) {
    try { localStorage.setItem('familyMapUser', JSON.stringify(familyCache(JSON.parse(cachedFamily)))); }
    catch { localStorage.removeItem('familyMapUser'); }
  }
  localStorage.removeItem('adminMapCredentials');
  const lastRole = localStorage.getItem('mapLastLoginRole') ?? 'elder';
  const userKey = lastRole === 'family' ? 'familyMapUser' : 'elderMapUser';
  const savedUser = localStorage.getItem(userKey);
  if (savedUser) {
    try {
      let restoredUser = JSON.parse(savedUser);
      if (restoredUser?.role !== 'family' && !restoredUser?.familyBindingCode) {
        restoredUser = {
          ...restoredUser,
          familyBindingCode: String(Math.floor(100000 + Math.random() * 900000)),
        };
        localStorage.setItem('elderMapUser', JSON.stringify(restoredUser));
      }
      currentUser.value = restoredUser;
    } catch {
      localStorage.removeItem(userKey);
    }
  }

  adminAccessToken.value = readAdminToken();
  if (!adminAccessToken.value) {
    adminSession.value = null;
  }
  return { user: currentUser.value, adminToken: adminAccessToken.value };
}

async function loginElder(credentials) {
  advanceFamilySession();
  familyRequestVersion += 1;
  const payload = await apiRequest('/api/auth/elder', {
    method: 'POST',
    body: { nickname: credentials.nickname, password: credentials.password },
    errorMessage: '登录失败，请稍后重试',
  });
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem('elderMapUser') || '{}');
  } catch {
    saved = {};
  }
  delete saved.password;
  if (saved.account && saved.account !== payload.account) saved = {};

  const databaseBinding = payload.binding;
  const user = {
    ...saved,
    ...payload,
    role: 'elder',
    mobilityType: saved.mobilityType || 'INDEPENDENT',
    profileComplete: false,
    questionnaireSkipped: false,
    createdAt: saved.createdAt || new Date().toISOString(),
    familyBindingCode: payload.family_binding_code ?? null,
    bindingStatus: databaseBinding?.status || null,
    boundElder: databaseBinding?.elder || null,
  };
  currentUser.value = user;
  isGuest.value = false;
  persistUser(user);
  return user;
}

async function loginFamily(credentials) {
  advanceFamilySession();
  if (currentUser.value?.role === 'family') currentUser.value = familyCache(currentUser.value);
  const payload = await familyRequest('/api/auth/family', { phone: credentials.phone });
  let saved = {};
  try {
    saved = familyCache(JSON.parse(localStorage.getItem('familyMapUser') || '{}'));
  } catch {
    saved = {};
  }
  // A different family phone is a different account: do not inherit its binding.
  if (saved.phone !== payload.phone) saved = {};

  const databaseBinding = payload.binding;
  const user = {
    ...saved,
    ...payload,
    role: 'family',
    password: '',
    mobilityType: saved.mobilityType || 'INDEPENDENT',
    profileComplete: true,
    questionnaireSkipped: false,
    createdAt: saved.createdAt || new Date().toISOString(),
    familyBindingCode: payload.family_binding_code ?? null,
    bindingStatus: databaseBinding?.status || null,
    boundElder: databaseBinding?.elder || null,
  };
  confirmedFamilyElder.value = databaseBinding?.status === 'ACTIVE' ? databaseBinding.elder || null : null;
  currentUser.value = user;
  isGuest.value = false;
  persistUser(user);
  return user;
}

async function loginAdmin(credentials) {
  const admin = await apiRequest('/api/auth/admin/login', {
    method: 'POST',
    body: credentials,
    errorMessage: '管理员登录失败',
  });
  if (!admin?.access_token) throw new Error('管理员登录失败');

  try {
    if (!globalThis.sessionStorage) throw new Error('sessionStorage unavailable');
    globalThis.sessionStorage.setItem(ADMIN_TOKEN_KEY, admin.access_token);
  } catch {
    throw new Error('无法保存管理员会话，请检查浏览器存储权限。');
  }
  adminAccessToken.value = admin.access_token;
  adminSession.value = { ...admin };
  return admin;
}

function enterGuestMode({ clearLastRole = false } = {}) {
  advanceFamilySession();
  familyRequestVersion += 1;
  currentUser.value = null;
  isGuest.value = true;
  if (clearLastRole) localStorage.removeItem('mapLastLoginRole');
}

function clearCurrentUser() {
  advanceFamilySession();
  familyRequestVersion += 1;
  currentUser.value = null;
  isGuest.value = false;
  // Keep the cached profile for the login form, but revoke its active role.
  localStorage.removeItem('mapLastLoginRole');
}

function getCurrentRole() {
  if (currentUser.value?.role) return currentUser.value.role;
  try {
    const role = localStorage.getItem('mapLastLoginRole');
    if (role !== 'elder' && role !== 'family') return null;
    const userKey = role === 'family' ? 'familyMapUser' : 'elderMapUser';
    const user = JSON.parse(localStorage.getItem(userKey) || 'null');
    return user?.role === role ? role : null;
  } catch {
    return null;
  }
}

function logout(role) {
  if (role !== 'admin') advanceFamilySession();
  if (role !== 'admin') familyRequestVersion += 1;
  if (role === 'admin') {
    try {
      globalThis.sessionStorage?.removeItem(ADMIN_TOKEN_KEY);
    } catch {
      // Memory state is still cleared if browser storage is unavailable.
    }
    adminAccessToken.value = '';
    adminSession.value = null;
    return null;
  }

  const loggedOutRole = currentUser.value?.role;
  currentUser.value = null;
  isGuest.value = false;
  localStorage.removeItem('mapLastLoginRole');
  if (loggedOutRole === 'elder') localStorage.removeItem('elderMapUser');
  if (loggedOutRole === 'family') localStorage.removeItem('familyMapUser');
  return loggedOutRole;
}

function updateProfile(profileData) {
  if (!currentUser.value) return null;
  const updatedUser = { ...currentUser.value, ...profileData };
  currentUser.value = updatedUser;
  persistUser(updatedUser);
  return updatedUser;
}

async function bindFamily(payload) {
  const familyUser = currentUser.value;
  if (!familyUser?.id) throw new Error('家属登录状态已失效，请重新登录。');
  const result = await familyRequest('/api/auth/family/bind', {
      family_user_id: familyUser.id,
      elder_account: payload.elderAccount,
      binding_code: payload.bindingCode,
  });
  const updatedFamily = { ...familyUser, boundElder: result.elder, bindingStatus: 'ACTIVE' };
  // A fresh server-confirmed binding replaces any denied/old monitor context.
  familySessionKey.value += 1;
  confirmedFamilyElder.value = result.elder;
  currentUser.value = updatedFamily;
  persistUser(updatedFamily);
  return { family: updatedFamily, elder: result.elder };
}

export function useAuthSession() {
  return {
    currentUser,
    isGuest,
    adminUser,
    adminAccessToken,
    restoreSession,
    loginElder,
    loginFamily,
    loginAdmin,
    enterGuestMode,
    clearCurrentUser,
    getCurrentRole,
    logout,
    updateProfile,
    bindFamily,
    familySharingDenied,
    confirmedFamilyElder,
    familySessionKey,
    revokeFamilySharing,
  };
}

// Router guards run before App.vue mounts, so initialize synchronously from
// the session-only token storage rather than waiting for restoreSession().
export { adminAccessToken };
