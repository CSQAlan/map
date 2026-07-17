<script setup>
defineEmits(['go-profile', 'skip']);
</script>

<template>
  <div class="profile-prompt-backdrop" role="dialog" aria-modal="true" aria-labelledby="health-reminder-title">
    <section class="health-reminder-card">
      <p class="section-kicker">再完善一步</p>
      <h2 id="health-reminder-title">要不要填写身体状况？</h2>
      <p>填写后，系统能更准确地避开台阶、陡坡和不适合您的路段。</p>
      <div class="health-reminder-actions">
        <button class="primary-action" type="button" @click="$emit('go-profile')">好的，去填写</button>
        <button class="secondary-action" type="button" @click="$emit('skip')">暂时跳过</button>
      </div>
    </section>
  </div>
</template>
