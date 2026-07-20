<script setup>
import { computed } from 'vue';
const props = defineProps({ activeMode: { type: String, required: true }, isGuest: Boolean });
defineEmits(['update:activeMode']);
const showNav = computed(() => !['login', 'guest-profile', 'family', 'family-binding', 'admin', 'admin-login', 'admin-collect'].includes(props.activeMode));
</script>
<template>
  <nav v-if="showNav" :class="['app-bottom-nav', { guest: isGuest }]" aria-label="页面导航">
    <button :class="{ active: activeMode === 'elder' || activeMode === 'navigation' }" type="button" @click="$emit('update:activeMode', 'elder')"><i>⌂</i><span>首页</span></button>
    <button :class="{ active: activeMode === 'recommend' }" type="button" @click="$emit('update:activeMode', 'recommend')"><i>⌁</i><span>路线</span></button>
    <button v-if="!isGuest" :class="{ active: activeMode === 'profile' }" type="button" @click="$emit('update:activeMode', 'profile')"><i>●</i><span>我的</span></button>
    <button v-else type="button" @click="$emit('update:activeMode', 'login')"><i>→</i><span>登录</span></button>
  </nav>
</template>
