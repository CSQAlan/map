<script setup>
defineOptions({ name: "MobilityPreferencePicker" });

defineProps({
  modelValue: { type: String, default: "" },
  options: { type: Array, default: () => [] },
  label: { type: String, default: "出行方式" },
});

const emit = defineEmits(["update:modelValue"]);
</script>

<template>
  <fieldset class="mobility-picker">
    <legend class="mobility-picker__legend">{{ label }}</legend>
    <div class="mobility-picker__options">
      <button
        v-for="option in options"
        :key="option.value"
        class="mobility-picker__option"
        :class="{ 'mobility-picker__option--selected': modelValue === option.value }"
        type="button"
        :aria-pressed="modelValue === option.value"
        @click="emit('update:modelValue', option.value)"
      >
        <span class="mobility-picker__copy">
          <strong>{{ option.label }}</strong>
          <span v-if="option.hint" class="mobility-picker__hint">{{ option.hint }}</span>
        </span>
        <span v-if="modelValue === option.value" class="mobility-picker__selected">
          <span aria-hidden="true">✓</span> 已选择
        </span>
      </button>
    </div>
  </fieldset>
</template>

<style scoped>
.mobility-picker {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.mobility-picker__legend {
  margin-bottom: 0.625rem;
  color: var(--color-ink, #203747);
  font-size: var(--text-body-large, 1.125rem);
  font-weight: 700;
}

.mobility-picker__options {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.625rem;
}

.mobility-picker__option {
  display: flex;
  min-width: 0;
  min-height: 3.25rem;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem 0.875rem;
  border: 1px solid #cbd8de;
  border-radius: var(--radius-control, 0.5rem);
  color: var(--color-ink, #203747);
  background: var(--color-paper, #fff);
  font: inherit;
  line-height: var(--line-body, 1.5);
  text-align: left;
  cursor: pointer;
}

.mobility-picker__option:hover {
  border-color: var(--color-blue, #286887);
}

.mobility-picker__option:focus-visible {
  outline: 3px solid var(--color-blue, #286887);
  outline-offset: 3px;
}

.mobility-picker__option--selected {
  border: 2px solid var(--color-blue, #286887);
  padding: calc(0.75rem - 1px) calc(0.875rem - 1px);
  background: var(--color-blue-soft, #e5eff3);
}

.mobility-picker__copy {
  display: grid;
  min-width: 0;
  gap: 0.125rem;
}

.mobility-picker__copy strong {
  font-size: var(--text-body, 1rem);
  font-weight: 700;
}

.mobility-picker__hint {
  color: #4d626d;
  font-size: var(--text-support, 0.875rem);
}

.mobility-picker__selected {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.25rem;
  color: var(--color-blue, #286887);
  font-size: var(--text-support, 0.875rem);
  font-weight: 700;
}

@media (min-width: 48rem) {
  .mobility-picker__options {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
