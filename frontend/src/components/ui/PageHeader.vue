<script setup>
defineOptions({ name: "PageHeader" });

defineProps({
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    default: "",
  },
  /** Heading level keeps document semantics explicit when reused in a section. */
  level: {
    type: Number,
    default: 1,
    validator: (value) => [1, 2, 3].includes(value),
  },
});
</script>

<template>
  <header class="page-header">
    <div class="page-header__copy">
      <component :is="`h${level}`" class="page-header__title">{{ title }}</component>
      <p v-if="description" class="page-header__description">{{ description }}</p>
      <div v-if="$slots.default" class="page-header__supporting">
        <slot />
      </div>
    </div>
    <div v-if="$slots.actions" class="page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem 1.5rem;
  padding-block: 0.25rem 1rem;
}

.page-header__copy {
  min-width: 0;
}

.page-header__title {
  margin: 0;
  color: var(--color-ink, #203747);
  font-size: clamp(1.625rem, 4vw, 2rem);
  font-weight: 700;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.page-header__description,
.page-header__supporting {
  max-width: 68ch;
  margin: 0.5rem 0 0;
  color: #526875;
  font-size: var(--text-body, 1rem);
  line-height: 1.55;
}

.page-header__actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
}

@media (max-width: 40rem) {
  .page-header {
    flex-direction: column;
    align-items: stretch;
  }

  .page-header__actions {
    justify-content: flex-start;
  }
}
</style>
