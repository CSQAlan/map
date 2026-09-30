<script setup>
import { ref } from 'vue';
const props = defineProps({ errorMessage: { type: String, default: '' }, defaultUsername: { type: String, default: 'admin' } });
const emit = defineEmits(['login', 'back']);
const account = ref('');
const password = ref('');
function submit() {
  if (!account.value.trim() || !password.value.trim()) return;
  emit('login', { username: account.value.trim(), password: password.value });
}
</script>

<template>
  <section class="admin-login-panel">
    <p class="section-kicker">管理后台</p><h1>助老地图数据治理</h1><p>仅限经授权的运营与数据管理人员访问。</p>
    <form autocomplete="off" @submit.prevent="submit">
      <label class="field-block"><span>管理员账号</span><input v-model="account" name="admin_account" autocomplete="username" required /></label>
      <label class="field-block"><span>密码</span><input v-model="password" name="admin_password" type="password" autocomplete="current-password" required /></label>
      <p v-if="errorMessage" class="error-line" role="alert" aria-live="assertive">{{ errorMessage }}</p>
      <button class="primary-action" type="submit">进入管理后台</button>
    </form>
    <p class="admin-login-hint">默认演示账号：{{ defaultUsername }}；默认密码：admin123。</p>
    <button class="text-action" type="button" @click="$emit('back')">返回普通登录</button>
  </section>
</template>

<style scoped>
.admin-login-panel {
  width: min(calc(100% - 2rem), 34rem);
  margin: clamp(1rem, 7vh, 4.5rem) auto 2rem;
  padding: clamp(1.25rem, 5vw, 2.5rem);
  border: 1px solid var(--border-subtle);
  border-radius: 1.25rem;
  background: var(--color-paper);
  box-shadow: 0 12px 34px rgb(32 55 71 / 9%);
}

.admin-login-panel h1 {
  margin: .25rem 0 .5rem;
  color: var(--color-ink);
  font-size: clamp(1.625rem, 5vw, 2.125rem);
  line-height: 1.25;
}

.admin-login-panel > p:not(.section-kicker) {
  color: #586c79;
  line-height: 1.55;
}

.admin-login-panel form {
  display: grid;
  gap: .875rem;
  margin-top: 1.5rem;
}

.admin-login-panel .field-block {
  display: grid;
  gap: .4rem;
  margin: 0;
}

.admin-login-panel .field-block span {
  color: var(--color-ink);
  font-size: 1rem;
  font-weight: 700;
}

.admin-login-panel input {
  width: 100%;
  min-height: 3.25rem;
  padding: .65rem .85rem;
  border: 1px solid #b9c8d0;
  border-radius: var(--radius-control);
  background: var(--color-paper);
}

.admin-login-panel input:focus-visible {
  border-color: var(--color-blue);
  outline: 3px solid rgb(40 104 135 / 22%);
  outline-offset: 2px;
}

.admin-login-panel .error-line {
  margin: 0;
  padding: .75rem .875rem;
  border-radius: var(--radius-control);
  color: var(--color-error);
  background: var(--color-error-soft);
  line-height: 1.5;
}

.admin-login-panel :deep(.primary-action) {
  min-height: 3.25rem;
  border-radius: var(--radius-control);
  color: #fff;
  background: var(--color-blue);
  font-size: 1.0625rem;
}

.admin-login-hint {
  padding: .75rem .875rem;
  border-radius: var(--radius-control);
  color: #654b20;
  background: var(--color-warning-soft);
  line-height: 1.5;
}

.admin-login-panel .text-action {
  width: 100%;
  min-height: var(--target-comfortable);
  color: var(--color-blue);
}

@media (max-width: 420px) {
  .admin-login-panel {
    width: calc(100% - 1.25rem);
    margin-top: .625rem;
    padding: 1.125rem;
    border-radius: 1rem;
  }
}
</style>
