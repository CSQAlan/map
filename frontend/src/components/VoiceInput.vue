<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { createSpeechInput } from '../services/speechInput.js';
const props = defineProps({ disabled: Boolean, label: { type: String, default: '语音输入' } });
const emit = defineEmits(['text', 'recording']);
const input = ref(null);
const { state, error, start, finish, cancel, file, dispose } = createSpeechInput({ onText: text => emit('text', text) });
const busy = computed(() => state.value !== 'idle');
watch(state, value => emit('recording', value !== 'idle'));
watch(() => props.disabled, value => { if (value) cancel(); });
function selectFile(event) { file(event.target.files?.[0]); event.target.value = ''; }
onBeforeUnmount(dispose);
</script>
<template>
  <div class="voice-input">
    <div class="voice-actions"><button type="button" :disabled="disabled || state === 'requesting' || state === 'transcribing'" @click="state === 'recording' ? finish() : start()">{{ state === 'recording' ? '说完了，开始识别' : state === 'requesting' ? '等待麦克风…' : state === 'transcribing' ? '正在识别…' : label }}</button><button v-if="busy" type="button" @click="cancel">取消</button><button v-else type="button" :disabled="disabled" @click="input?.click()">选择录音</button></div>
    <input ref="input" type="file" accept="audio/*,video/mp4" hidden @change="selectFile" />
    <p v-if="state === 'recording'" role="status">正在录音，最多30秒。说完后点击识别。</p><p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>
<style scoped>
.voice-input { min-width: 0; font-size: 14px; }.voice-actions { display:flex; flex-wrap:wrap; gap:8px; }.voice-actions button { min-height:44px; border:1px solid #b9d2c5; border-radius:12px; background:#eef6f0; color:#205747; padding:8px 12px; font:inherit; font-weight:650; }.voice-actions button:disabled { opacity:.55; }.voice-input p { margin:6px 0; color:#865026; line-height:1.5; }
</style>
