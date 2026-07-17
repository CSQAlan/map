<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';

const props = defineProps({
  modelValue: { type: String, default: '' },
  options: { type: Array, default: () => [] },
  label: { type: String, required: true },
  icon: { type: String, default: '●' },
});

const emit = defineEmits(['update:modelValue']);
const listening = ref(false);
const speechSupported = computed(() =>
  typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
);
let recognition = null;

function updateValue(value) {
  emit('update:modelValue', value);
}

function startVoiceInput() {
  if (!speechSupported.value || listening.value) return;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new Recognition();
  recognition.lang = 'zh-CN';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onstart = () => { listening.value = true; };
  recognition.onresult = (event) => updateValue(event.results[0][0].transcript.trim());
  recognition.onerror = () => { listening.value = false; };
  recognition.onend = () => { listening.value = false; recognition = null; };
  recognition.start();
}

onBeforeUnmount(() => recognition?.abort());
</script>

<template>
  <label class="location-input">
    <span class="location-input-label"><i>{{ icon }}</i>{{ label }}</span>
    <div class="location-input-control">
      <select
        :value="modelValue"
        :aria-label="`选择${label}`"
        @change="updateValue($event.target.value)"
      >
        <option v-for="option in options" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
      <button
        v-if="speechSupported"
        class="voice-button"
        type="button"
        :class="{ listening }"
        :aria-label="`语音输入${label}`"
        @click.prevent="startVoiceInput"
      >
        {{ listening ? '正在听' : '语音' }}
      </button>
    </div>
  </label>
</template>
