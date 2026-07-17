<script setup>
defineProps({
  modelValue: {
    type: String,
    required: true
  },
  options: {
    type: Array,
    required: true
  }
});

defineEmits(['update:modelValue']);
</script>

<template>
  <div>
    <p class="section-kicker">推荐策略</p>
    <div class="strategy-grid">
      <button
        v-for="strategy in options"
        :key="strategy.value"
        class="strategy-chip"
        :class="{ selected: modelValue === strategy.value }"
        type="button"
        @click="$emit('update:modelValue', strategy.value)"
      >
        <strong>{{ strategy.label }}</strong>
        <span>{{ strategy.hint }}</span>
      </button>
    </div>
  </div>
</template>
