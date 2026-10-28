<script setup>
import { ref } from 'vue';
import VoiceInput from './VoiceInput.vue';
import { matchSpokenPlace } from '../services/placeSpeech.js';
const props = defineProps({ modelValue: { type: String, default: '' }, options: { type: Array, default: () => [] }, label: { type: String, required: true }, icon: { type: String, default: '●' } });
const emit = defineEmits(['update:modelValue']);
const result = ref('');
function useText(text) { const value = matchSpokenPlace(text, props.options); if (value != null) { emit('update:modelValue', value); result.value = `已识别并选择：${props.options.find(o => o.value === value)?.label}`; } else result.value = `识别为“${text}”，未唯一匹配，请在列表中选择地点。`; }
</script>
<template>
  <div class="location-input"><label class="location-input-label"><i>{{ icon }}</i>{{ label }}</label><div class="location-input-control"><select :value="modelValue" :aria-label="`选择${label}`" @change="emit('update:modelValue', $event.target.value)"><option value="" disabled>请选择{{ label }}</option><option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option></select></div><VoiceInput :label="`语音输入${label}`" @text="useText" /><p v-if="result" class="location-voice-result" role="status">{{ result }}</p></div>
</template>
<style scoped>.location-voice-result { font-size:14px; line-height:1.6; color:#4d665b; margin:6px 0; }.voice-input { margin-top:8px; }</style>
