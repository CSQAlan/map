<script setup>
defineProps({ alerts: { type: Array, default: () => [] } });
</script>

<template>
  <section class="family-content-card family-alert-list" aria-labelledby="family-alert-heading">
    <p class="section-kicker">告警中心</p>
    <h2 id="family-alert-heading">
      {{ alerts.length ? `收到 ${alerts.length} 条待处理告警` : '暂未收到新的紧急求助或异常停留告警' }}
    </h2>
    <article v-for="alert in alerts" :key="alert.id" class="family-alert">
      <strong>{{ alert.event_type === 'SOS' ? '紧急求助' : alert.event_type }}</strong>
      <p>{{ alert.description || '老人端已触发告警，请尽快联系老人。' }}</p>
      <small>{{ alert.created_at || '刚刚' }}</small>
    </article>
    <p class="privacy-note">告警事件、关联对象及时间均由后端数据库记录，并只同步给已关联家属。</p>
  </section>
</template>
