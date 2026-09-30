<script setup>
defineProps({
  elderName: { type: String, required: true },
  account: { type: String, default: '—' },
  isNavigating: { type: Boolean, default: false },
});
</script>

<template>
  <section class="family-elder-card" aria-label="已关联老人状态">
    <div>
      <span class="family-avatar" aria-hidden="true">护</span>
      <div>
        <strong>{{ elderName }}</strong>
        <p>
          <i :class="['online-dot', { offline: !isNavigating }]" aria-hidden="true"></i>
          {{ isNavigating ? '导航中，数据每 5 秒同步' : '当前未开始导航' }}
        </p>
      </div>
    </div>
    <span class="binding-account">数字账号：{{ account }}</span>
  </section>
</template>
