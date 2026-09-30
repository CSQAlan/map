<script setup>
import { useRoute } from "vue-router";
import "../styles/layouts.css";

defineOptions({ name: "ElderLayout" });

const route = useRoute();
const navigation = [
  { label: "首页", to: "/elder/home" },
  { label: "找路线", to: "/elder/routes" },
  { label: "踩点资料", to: "/elder/survey" },
  { label: "我的", to: "/elder/profile" },
];
</script>

<template>
  <div class="role-shell elder-shell" :class="{ 'elder-shell--focused': route.meta.hidePrimaryNav }">
    <aside v-if="!route.meta.hidePrimaryNav" class="role-sidebar elder-shell__sidebar" aria-label="老人端主导航">
      <a class="role-brand" href="#/elder/home">
        <span class="role-brand__mark" aria-hidden="true">助</span>
        <span class="role-brand__name">助老地图</span>
      </a>
      <nav class="role-nav role-nav--vertical" aria-label="主要页面">
        <RouterLink
          v-for="item in navigation"
          :key="item.to"
          class="role-nav__link"
          :to="item.to"
        >
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>

    <header v-if="!route.meta.hidePrimaryNav" class="role-mobile-header elder-shell__mobile-header">
      <a class="role-brand" href="#/elder/home">
        <span class="role-brand__mark" aria-hidden="true">助</span>
        <span class="role-brand__name">助老地图</span>
      </a>
      <nav class="role-nav role-nav--compact elder-shell__tablet-nav" aria-label="主要页面">
        <RouterLink
          v-for="item in navigation"
          :key="item.to"
          class="role-nav__link"
          :to="item.to"
        >
          {{ item.label }}
        </RouterLink>
      </nav>
    </header>

    <main class="role-main elder-shell__main">
      <slot>
        <RouterView />
      </slot>
    </main>

    <nav
      v-if="!route.meta.hidePrimaryNav"
      class="role-bottom-nav elder-shell__bottom-nav"
      aria-label="主要页面"
    >
      <RouterLink
        v-for="item in navigation"
        :key="item.to"
        class="role-bottom-nav__link"
        :to="item.to"
      >
        {{ item.label }}
      </RouterLink>
    </nav>
  </div>
</template>
