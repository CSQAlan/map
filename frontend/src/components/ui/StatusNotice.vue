<script setup>
import { computed } from "vue";

defineOptions({ name: "StatusNotice" });

const props = defineProps({
  /** `error` announces urgently; other tones announce politely. */
  tone: {
    type: String,
    default: "info",
    validator: (value) => ["info", "success", "warning", "error"].includes(value),
  },
  title: {
    type: String,
    default: "",
  },
});

const noticeClass = computed(() => ["status-notice", `status-notice--${props.tone}`]);
const liveMode = computed(() => (props.tone === "error" ? "assertive" : "polite"));
const role = computed(() => (props.tone === "error" ? "alert" : "status"));
</script>

<template>
  <div :class="noticeClass" :role="role" :aria-live="liveMode" aria-atomic="true">
    <span class="status-notice__marker" aria-hidden="true"></span>
    <div class="status-notice__content">
      <p v-if="title" class="status-notice__title">{{ title }}</p>
      <div class="status-notice__message"><slot /></div>
    </div>
  </div>
</template>

<style scoped>
.status-notice {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.875rem 1rem;
  border: 1px solid transparent;
  border-radius: var(--radius-control, 0.5rem);
  font-size: var(--text-body, 1rem);
  line-height: 1.5;
}

.status-notice--info {
  color: #244e63;
  border-color: #c8dce5;
  background: var(--color-info-soft, #eaf2f6);
}

.status-notice--success {
  color: #20543f;
  border-color: #c5dfd0;
  background: var(--color-success-soft, #eaf4ef);
}

.status-notice--warning {
  color: #70450f;
  border-color: #e8d3b2;
  background: var(--color-warning-soft, #fbf3e8);
}

.status-notice--error {
  color: #762d2a;
  border-color: #e8c7c4;
  background: var(--color-error-soft, #fbefee);
}

.status-notice__marker {
  width: 0.625rem;
  height: 0.625rem;
  flex: 0 0 auto;
  margin-top: 0.45rem;
  border-radius: 50%;
  background: currentColor;
}

.status-notice__content {
  min-width: 0;
}

.status-notice__title {
  margin: 0;
  font-weight: 700;
}

.status-notice__message {
  overflow-wrap: anywhere;
}

.status-notice__title + .status-notice__message {
  margin-top: 0.125rem;
}
</style>
