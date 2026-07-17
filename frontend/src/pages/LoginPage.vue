<script setup>
import { ref, watch } from 'vue';

const props = defineProps({
  loading: Boolean,
  savedUser: { type: Object, default: null },
});
const emit = defineEmits(['login', 'skip', 'quick-login']);
const username = ref(props.savedUser?.username ?? '');
const password = ref(props.savedUser?.password ?? '');

watch(
  () => props.savedUser,
  (user) => {
    username.value = user?.username ?? '';
    password.value = user?.password ?? '';
  },
  { deep: true }
);

function handleLogin() {
  if (!username.value.trim() || !password.value.trim()) {
    alert('请输入用户名和密码。');
    return;
  }
  emit('login', { username: username.value.trim(), password: password.value.trim() });
}
</script>

<template>
  <section class="login-panel">
    <div class="login-hero">
      <p class="section-kicker">欢迎使用</p>
      <h2>助老地图</h2>
      <p>为老人提供安全、便捷、易理解的出行路线规划。</p>
    </div>

    <div v-if="savedUser" class="saved-account">
      <strong>欢迎回来，{{ savedUser.username }}</strong>
      <span>已为您填入上次保存的登录信息</span>
      <button class="secondary-action" type="button" @click="$emit('quick-login')">使用已保存信息登录</button>
    </div>

    <form class="login-form" @submit.prevent="handleLogin">
      <label class="field-block">
        <span>姓名或账号</span>
        <input v-model="username" type="text" placeholder="请输入姓名或账号" required maxlength="50" />
      </label>
      <label class="field-block">
        <span>密码</span>
        <input v-model="password" type="password" placeholder="请输入密码" required maxlength="50" />
      </label>
      <button class="primary-action" type="submit" :disabled="loading">
        {{ loading ? '登录中…' : '登录 / 注册' }}
      </button>
      <p class="login-hint">首次使用将自动注册，登录信息会保存在本机。</p>
    </form>

    <div class="skip-section">
      <button class="secondary-action skip-btn" type="button" @click="$emit('skip')">跳过登录，直接进入</button>
      <p class="skip-hint">访客模式不会保存老人画像和个人信息。</p>
    </div>
  </section>
</template>
