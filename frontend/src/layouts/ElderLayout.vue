<script setup>
import { useRoute } from 'vue-router';
import AppIcon from '../components/ui/AppIcon.vue';
import '../styles/layouts.css';
const route = useRoute();
const navigation = [
  { label: '首页', to: '/elder/home', icon: 'home' },
  { label: '路线', to: '/elder/routes', icon: 'route' },
  { label: '问助手', to: '/elder/assistant', icon: 'chat' },
  { label: '踩点资料', to: '/elder/survey', icon: 'layers' },
  { label: '我的', to: '/elder/profile', icon: 'user' },
];
</script>

<template>
  <div class="role-shell elder-shell" :class="{ 'elder-shell--focused': route.meta.hidePrimaryNav }">
    <aside v-if="!route.meta.hidePrimaryNav" class="role-sidebar elder-shell__sidebar" aria-label="老人端主导航">
      <a class="role-brand" href="#/elder/home"><span class="role-brand__mark"><AppIcon name="leaf" /></span><span class="role-brand__name">助老地图<small>陪您走好每一步</small></span></a>
      <nav class="role-nav role-nav--vertical" aria-label="主要页面"><RouterLink v-for="item in navigation" :key="item.to" class="role-nav__link" :to="item.to"><AppIcon :name="item.icon" /><span>{{ item.label }}</span></RouterLink></nav>
      <div class="sidebar-note"><AppIcon name="shield" /><p>出门慢一点<br />安心多一点</p><small>重庆 · 师大苑试点</small></div>
    </aside>
    <header v-if="!route.meta.hidePrimaryNav" class="role-mobile-header elder-shell__mobile-header">
      <a class="role-brand" href="#/elder/home"><span class="role-brand__mark"><AppIcon name="leaf" /></span><span class="role-brand__name">助老地图</span></a>
      <span class="pilot-badge"><span></span>师大苑试点</span>
      <nav class="role-nav role-nav--compact elder-shell__tablet-nav" aria-label="主要页面"><RouterLink v-for="item in navigation" :key="item.to" class="role-nav__link" :to="item.to">{{ item.label }}</RouterLink></nav>
    </header>
    <main class="role-main elder-shell__main"><slot><RouterView /></slot></main>
    <nav v-if="!route.meta.hidePrimaryNav" class="role-bottom-nav elder-shell__bottom-nav" aria-label="主要页面">
      <RouterLink v-for="item in navigation" :key="item.to" class="role-bottom-nav__link" :to="item.to"><span class="bottom-nav-icon"><AppIcon :name="item.icon" :size="23" /></span><span>{{ item.label }}</span></RouterLink>
    </nav>
  </div>
</template>
