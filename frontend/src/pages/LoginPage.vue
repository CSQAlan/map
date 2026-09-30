<script setup>
import { ref, watch } from 'vue';

const props = defineProps({ loading: Boolean, savedUser: { type: Object, default: null }, error: String });
const emit = defineEmits(['login', 'skip', 'admin', 'role-change']);
const role = ref('elder');
const nickname = ref('');
const password = ref('');
const phone = ref('');

watch(() => props.savedUser, (user) => {
  if (!user) return;
  role.value = user.role === 'family' ? 'family' : 'elder';
  nickname.value = user.nickname ?? '';
  password.value = '';
  phone.value = user.phone ?? '';
}, { immediate: true });

function changeRole(nextRole) {
  role.value = nextRole;
  nickname.value = '';
  password.value = '';
  phone.value = '';
  emit('role-change', nextRole);
}

function submit() {
  if (role.value === 'elder') {
    if (!nickname.value.trim() || !password.value.trim()) return;
    emit('login', { role: 'elder', nickname: nickname.value.trim(), password: password.value.trim() });
    return;
  }
  if (!phone.value.trim()) return;
  emit('login', { role: 'family', phone: phone.value.trim() });
}
</script>

<template>
  <section class="login-panel role-login-panel">
    <div class="login-hero"><p class="section-kicker">助老出行</p><h1>安心出行，家人放心</h1><p>选择身份后登录或注册。</p></div>
    <div class="role-switch" role="group" aria-label="选择登录身份"><button :class="{ active: role === 'elder' }" :aria-pressed="role === 'elder'" type="button" @click="changeRole('elder')">我是老人</button><button :class="{ active: role === 'family' }" :aria-pressed="role === 'family'" type="button" @click="changeRole('family')">我是家属</button></div>
    <form class="login-form" autocomplete="off" @submit.prevent="submit">
      <template v-if="role === 'elder'"><label class="field-block"><span>昵称</span><input v-model="nickname" name="elder_nickname" autocomplete="username" required placeholder="请输入昵称" /></label><label class="field-block"><span>密码</span><input v-model="password" name="elder_password" type="password" autocomplete="current-password" required placeholder="请输入密码" /></label><p class="login-hint">首次注册后，系统会自动分配数字账号，可在“我的”中查看。</p></template>
      <template v-else><label class="field-block"><span>手机号</span><input v-model="phone" name="family_phone" type="tel" autocomplete="tel" inputmode="tel" maxlength="20" required placeholder="请输入手机号注册或登录" /></label><p class="login-hint">家属仅使用手机号注册。登录后请关联老人的数字账号和关联码。</p></template>
      <p v-if="error" class="login-error" role="alert" aria-live="assertive">{{ error }}</p><button class="primary-action" type="submit" :disabled="loading" :aria-busy="loading">{{ loading ? '处理中…' : role === 'elder' ? '登录 / 注册' : '手机号注册 / 登录' }}</button>
    </form>
    <p v-if="savedUser && savedUser.role === role" class="login-hint saved-login-hint">已填入上次使用的{{ role === 'elder' ? '昵称' : '手机号' }}，请继续完成登录。</p>
    <div v-if="role === 'elder'" class="skip-section"><button class="secondary-action skip-btn" type="button" @click="$emit('skip')">跳过登录，直接使用</button><p class="skip-hint">访客模式不保存个人资料与问卷信息。</p></div>
    <button class="admin-entry" type="button" @click="$emit('admin')">管理入口</button>
  </section>
</template>

<style scoped>
.role-login-panel {
  width: min(100% - 2rem, 34rem);
  margin: clamp(1rem, 6vh, 4rem) auto 2rem;
  padding: clamp(1.25rem, 5vw, 2.5rem);
  border: 1px solid var(--border-subtle);
  border-radius: 1.25rem;
  background: var(--color-paper);
  box-shadow: 0 12px 34px rgb(32 55 71 / 9%);
}

.login-hero h1 {
  margin: .2rem 0 .5rem;
  color: var(--color-ink);
  font-size: clamp(1.75rem, 6vw, 2.5rem);
  line-height: 1.2;
}

.login-hero > p:last-child,
.login-hint,
.skip-hint {
  color: #586c79;
  line-height: 1.55;
}

.role-switch {
  gap: .5rem;
  margin: 1.5rem 0 1rem;
  background: var(--color-fog);
}

.role-switch button {
  min-height: var(--target-comfortable);
  color: var(--color-ink);
}

.role-switch button.active {
  color: #fff;
  background: var(--color-blue);
  box-shadow: none;
}

.login-form {
  display: grid;
  gap: .875rem;
}

.field-block {
  display: grid;
  gap: .4rem;
  margin: 0;
}

.field-block span {
  color: var(--color-ink);
  font-size: 1rem;
  font-weight: 700;
}

.field-block input {
  width: 100%;
  min-height: 3.25rem;
  padding: .65rem .85rem;
  border: 1px solid #b9c8d0;
  border-radius: var(--radius-control);
  background: var(--color-paper);
  font-size: 1rem;
}

.field-block input:focus-visible {
  border-color: var(--color-blue);
  outline: 3px solid rgb(40 104 135 / 22%);
  outline-offset: 2px;
}

.login-hint {
  margin: 0;
  font-size: .9375rem;
}

.login-error {
  margin: 0;
  padding: .75rem .875rem;
  border-radius: var(--radius-control);
  color: var(--color-error);
  background: var(--color-error-soft);
  line-height: 1.5;
}

.role-login-panel :deep(.primary-action),
.skip-btn {
  width: 100%;
  min-height: 3.25rem;
  border-radius: var(--radius-control);
  font-size: 1.0625rem;
}

.role-login-panel :deep(.primary-action) {
  color: #fff;
  background: var(--color-blue);
}

.role-login-panel :deep(.primary-action:disabled) {
  opacity: .68;
}

.saved-login-hint {
  margin-top: 1rem;
  padding: .75rem .875rem;
  border-radius: var(--radius-control);
  background: var(--color-info-soft);
}

.skip-section {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid #e1e8ec;
}

.skip-hint {
  margin: .4rem 0 0;
  text-align: center;
  font-size: .875rem;
}

.admin-entry {
  display: block;
  min-height: var(--target-min);
  margin: .75rem auto 0;
  padding: 0 .75rem;
  border: 0;
  color: var(--color-blue);
  background: transparent;
}

@media (max-width: 420px) {
  .role-login-panel {
    width: calc(100% - 1.25rem);
    margin-top: .625rem;
    padding: 1.125rem;
    border-radius: 1rem;
  }
}
</style>
