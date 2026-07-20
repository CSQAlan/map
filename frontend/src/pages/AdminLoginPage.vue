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
      <label class="field-block"><span>管理员账号</span><input v-model="account" name="admin_account" autocomplete="off" /></label>
      <label class="field-block"><span>密码</span><input v-model="password" name="admin_password" type="password" autocomplete="new-password" /></label>
      <p v-if="errorMessage" class="error-line">{{ errorMessage }}</p>
      <button class="primary-action" type="submit">进入管理后台</button>
    </form>
    <p class="admin-login-hint">默认演示账号：{{ defaultUsername }}；默认密码：admin123。</p>
    <button class="text-action" type="button" @click="$emit('back')">返回普通登录</button>
  </section>
</template>
