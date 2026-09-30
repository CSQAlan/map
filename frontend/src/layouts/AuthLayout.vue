<script setup>
import "../styles/layouts.css";

defineOptions({ name: "AuthLayout" });
</script>

<template>
  <div class="role-shell auth-shell">
    <header class="auth-shell__header">
      <a class="role-brand" href="#/login" aria-label="助老地图，返回登录">
        <span class="role-brand__mark" aria-hidden="true">助</span>
        <span class="role-brand__name">助老地图</span>
      </a>
    </header>
    <main class="auth-shell__main">
      <slot>
        <RouterView />
      </slot>
    </main>
  </div>
</template>
