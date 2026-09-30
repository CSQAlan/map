<script setup>
import { computed } from "vue";

defineOptions({ name: "AppButton" });

const props = defineProps({
  /** Visual intent; native button semantics are preserved. */
  variant: {
    type: String,
    default: "primary",
    validator: (value) => ["primary", "secondary", "quiet", "danger"].includes(value),
  },
  /** Native button type. Defaults to `button` to avoid accidental form submits. */
  type: {
    type: String,
    default: "button",
    validator: (value) => ["button", "submit", "reset"].includes(value),
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  /** Shows progress and temporarily disables activation. */
  loading: {
    type: Boolean,
    default: false,
  },
});

const buttonClass = computed(() => [
  "app-button",
  `app-button--${props.variant}`,
  { "app-button--loading": props.loading },
]);
</script>

<template>
  <button
    :type="type"
    :class="buttonClass"
    :disabled="disabled || loading"
    :aria-busy="loading ? 'true' : undefined"
  >
    <span v-if="loading" class="app-button__spinner" aria-hidden="true"></span>
    <span class="app-button__label"><slot /></span>
  </button>
</template>

<style scoped>
.app-button {
  display: inline-flex;
  min-width: var(--target-min, 3rem);
  min-height: var(--target-comfortable, 3.25rem);
  align-items: center;
  justify-content: center;
  gap: 0.625rem;
  padding: 0.625rem 1rem;
  border: 1px solid transparent;
  border-radius: var(--radius-control, 0.5rem);
  font: inherit;
  font-weight: 650;
  line-height: 1.25;
  text-align: center;
  transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease;
}

.app-button--primary {
  color: #fff;
  background: var(--color-blue, #286887);
}

.app-button--primary:hover:not(:disabled) {
  background: #205772;
}

.app-button--secondary {
  color: var(--color-ink, #203747);
  border-color: #b8cbd4;
  background: var(--color-paper, #fff);
}

.app-button--secondary:hover:not(:disabled) {
  background: var(--color-blue-soft, #e5eff3);
}

.app-button--quiet {
  color: var(--color-blue, #286887);
  background: transparent;
}

.app-button--quiet:hover:not(:disabled) {
  background: var(--color-blue-soft, #e5eff3);
}

.app-button--danger {
  color: #fff;
  background: var(--color-error, #a13c38);
}

.app-button--danger:hover:not(:disabled) {
  background: #842f2c;
}

.app-button:disabled {
  cursor: not-allowed;
  opacity: 0.68;
}

.app-button__label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.app-button__spinner {
  width: 1rem;
  height: 1rem;
  flex: 0 0 auto;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: app-button-spin 700ms linear infinite;
}

@keyframes app-button-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .app-button {
    transition: none;
  }

  .app-button__spinner {
    animation: none;
    border-right-color: currentColor;
    opacity: 0.72;
  }
}
</style>
