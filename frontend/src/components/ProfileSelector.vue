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
    <p class="section-kicker">老人画像</p>
    <div class="profile-grid">
      <button
        v-for="profile in options"
        :key="profile.value"
        class="profile-chip"
        :class="{ selected: modelValue === profile.value }"
        type="button"
        @click="$emit('update:modelValue', profile.value)"
      >
        <strong>{{ profile.label }}</strong>
        <span>{{ profile.hint }}</span>
      </button>
    </div>
  </div>
</template>
