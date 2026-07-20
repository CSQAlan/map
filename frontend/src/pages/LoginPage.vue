<script setup>
import { ref, watch } from 'vue';

const props = defineProps({ loading: Boolean, savedUser: { type: Object, default: null }, error: String });
const emit = defineEmits(['login', 'skip', 'quick-login', 'admin', 'role-change']);
const role = ref('elder');
const nickname = ref('');
const password = ref('');
const phone = ref('');

watch(() => props.savedUser, (user) => {
  if (!user) return;
  role.value = user.role === 'family' ? 'family' : 'elder';
  nickname.value = user.nickname ?? '';
  password.value = user.password ?? '';
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
    <div class="role-switch" role="tablist"><button :class="{ active: role === 'elder' }" type="button" @click="changeRole('elder')">我是老人</button><button :class="{ active: role === 'family' }" type="button" @click="changeRole('family')">我是家属</button></div>
    <form class="login-form" autocomplete="off" @submit.prevent="submit">
      <template v-if="role === 'elder'"><label class="field-block"><span>昵称</span><input v-model="nickname" name="elder_nickname" autocomplete="off" required placeholder="请输入昵称" /></label><label class="field-block"><span>密码</span><input v-model="password" name="elder_password" type="password" autocomplete="new-password" required placeholder="请输入密码" /></label><p class="login-hint">首次注册后，系统会自动分配数字账号，可在“我的”中查看。</p></template>
      <template v-else><label class="field-block"><span>手机号</span><input v-model="phone" type="tel" inputmode="numeric" maxlength="20" required placeholder="请输入手机号注册或登录" /></label><p class="login-hint">家属仅使用手机号注册。登录后请关联老人的数字账号和关联码。</p></template>
      <p v-if="error" class="login-error">{{ error }}</p><button class="primary-action" type="submit" :disabled="loading">{{ loading ? '处理中…' : role === 'elder' ? '登录 / 注册' : '手机号注册 / 登录' }}</button>
    </form>
    <button v-if="savedUser && savedUser.role === role" class="secondary-action saved-login-button" type="button" @click="$emit('quick-login')">使用已保存信息登录</button>
    <div v-if="role === 'elder'" class="skip-section"><button class="secondary-action skip-btn" type="button" @click="$emit('skip')">跳过登录，直接使用</button><p class="skip-hint">访客模式不保存个人资料与问卷信息。</p></div>
    <button class="admin-entry" type="button" @click="$emit('admin')">管理入口</button>
  </section>
</template>
