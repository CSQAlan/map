<script setup>
import "../styles/layouts.css";

defineOptions({ name: "AdminLayout" });

const navigation = [
  { label: "工作总览", to: "/admin/overview" },
  { label: "踩点审核", to: "/admin/collect" },
  { label: "资料落点", to: "/admin/survey-placement" },
];
</script>

<template>
  <div class="role-shell admin-shell">
    <aside class="role-sidebar admin-shell__sidebar" aria-label="管理端主导航">
      <a class="role-brand" href="#/admin/overview">
        <span class="role-brand__mark" aria-hidden="true">管</span>
        <span class="role-brand__name">管理工作台</span>
      </a>
      <nav class="role-nav role-nav--vertical" aria-label="管理页面">
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

    <header class="role-mobile-header admin-shell__mobile-header">
      <a class="role-brand" href="#/admin/overview">
        <span class="role-brand__mark" aria-hidden="true">管</span>
        <span class="role-brand__name">管理工作台</span>
      </a>
      <nav class="role-nav role-nav--scroll" aria-label="管理页面">
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

    <main class="role-main admin-shell__main">
      <slot>
        <RouterView />
      </slot>
    </main>
  </div>
</template>
