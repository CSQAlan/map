<script setup>
import "../styles/layouts.css";

defineOptions({ name: "FamilyLayout" });

const navigation = [
  { label: "状态总览", to: "/family/dashboard" },
  { label: "绑定老人", to: "/family/binding" },
];
</script>

<template>
  <div class="role-shell family-shell">
    <aside class="role-sidebar family-shell__sidebar" aria-label="家属端主导航">
      <a class="role-brand" href="#/family/dashboard">
        <span class="role-brand__mark" aria-hidden="true">家</span>
        <span class="role-brand__name">家属服务</span>
      </a>
      <nav class="role-nav role-nav--vertical" aria-label="家属页面">
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

    <header class="role-mobile-header family-shell__mobile-header">
      <a class="role-brand" href="#/family/dashboard">
        <span class="role-brand__mark" aria-hidden="true">家</span>
        <span class="role-brand__name">家属服务</span>
      </a>
      <nav class="role-nav role-nav--compact" aria-label="家属页面">
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

    <main class="role-main family-shell__main">
      <slot>
        <RouterView />
      </slot>
    </main>
  </div>
</template>
