<script setup>
defineProps({ options: { type: Array, default: () => [] } });
defineEmits(['select']);
</script>

<template>
  <div class="profile-prompt-backdrop" role="dialog" aria-modal="true" aria-labelledby="profile-prompt-title">
    <section class="profile-prompt-card">
      <p class="section-kicker">出行设置</p>
      <h2 id="profile-prompt-title">请先选择您的出行情况</h2>
      <p>系统会据此避开台阶、陡坡等不适合的路段。</p>
      <div class="profile-prompt-options">
        <button v-for="option in options" :key="option.value" type="button" @click="$emit('select', option.value)">
          <strong>{{ option.label }}</strong><span>{{ option.hint }}</span>
        </button>
      </div>
    </section>
  </div>
</template>
