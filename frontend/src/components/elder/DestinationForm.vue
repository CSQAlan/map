<script setup>
import LocationInput from "../LocationInput.vue";

defineOptions({ name: "DestinationForm" });

const props = defineProps({
  startName: { type: String, default: "" },
  endName: { type: String, default: "" },
  startOptions: { type: Array, default: () => [] },
  endOptions: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  error: { type: String, default: "" },
});

const emit = defineEmits(["update:startName", "update:endName", "submit"]);

function submitForm() {
  if (props.loading) return;
  emit("submit", { startName: props.startName, endName: props.endName });
}
</script>

<template>
  <form class="destination-form" @submit.prevent="submitForm">
    <div class="destination-form__fields">
      <LocationInput
        :model-value="startName"
        :options="startOptions"
        label="出发地点"
        icon="起"
        @update:model-value="emit('update:startName', $event)"
      />
      <LocationInput
        :model-value="endName"
        :options="endOptions"
        label="目的地"
        icon="终"
        @update:model-value="emit('update:endName', $event)"
      />
    </div>

    <p v-if="error" class="destination-form__error" role="alert" aria-live="assertive">
      {{ error }}
    </p>

    <button
      class="destination-form__submit"
      type="submit"
      :disabled="loading"
      :aria-busy="loading ? 'true' : undefined"
    >
      {{ loading ? "正在查询路线…" : "查询适合的路线" }}
    </button>
  </form>
</template>

<style scoped>
.destination-form {
  display: grid;
  gap: 1rem;
  width: 100%;
}

.destination-form__fields {
  display: grid;
  gap: 1rem;
}

.destination-form__error {
  margin: 0;
  padding: 0.75rem 0.875rem;
  border: 1px solid #e8c7c4;
  border-radius: var(--radius-control, 0.5rem);
  color: #762d2a;
  background: var(--color-error-soft, #fbefee);
  font-size: var(--text-body, 1rem);
  line-height: var(--line-body, 1.5);
}

.destination-form__submit {
  display: inline-flex;
  min-height: 3.25rem;
  align-items: center;
  justify-content: center;
  padding: 0.75rem 1rem;
  border: 1px solid transparent;
  border-radius: var(--radius-control, 0.5rem);
  color: var(--color-paper, #fff);
  background: var(--color-blue, #286887);
  font: inherit;
  font-size: var(--text-body-large, 1.125rem);
  font-weight: 700;
  line-height: 1.3;
}

.destination-form__submit:hover:not(:disabled) {
  background: #205772;
}

.destination-form__submit:focus-visible {
  outline: 3px solid var(--color-blue, #286887);
  outline-offset: 3px;
}

.destination-form__submit:disabled {
  cursor: wait;
  opacity: 0.72;
}

@media (min-width: 48rem) {
  .destination-form__fields {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
