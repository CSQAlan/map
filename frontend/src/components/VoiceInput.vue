<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { createSpeechInput } from '../services/speechInput.js';
const props = defineProps({ disabled: Boolean, label: { type: String, default: '语音输入' } });
const emit = defineEmits(['text', 'recording']);
const input = ref(null);
const { state, error, start, finish, cancel, file, dispose } = createSpeechInput({ onText: text => emit('text', text) });
const busy = computed(() => state.value !== 'idle');
const elapsed = ref(0);
let clock;
let startedAt = 0;
const statusText = computed(() => {
  if (state.value === 'requesting') return '请在浏览器提示中允许使用麦克风，也可以取消后选择已有录音。';
  if (state.value === 'recording') return '正在录音。说完后点击识别，满30秒会自动开始识别。';
  if (state.value === 'transcribing') return '正在将录音转成文字，首次识别可能稍慢。请稍候，也可以取消；识别后请核对文字。';
  return '';
});
watch(state, value => {
  clearInterval(clock);
  clock = null;
  if (value === 'recording') {
    elapsed.value = 0;
    startedAt = Date.now();
    clock = setInterval(() => { elapsed.value = Math.min(30, Math.floor((Date.now() - startedAt) / 1000)); }, 250);
  }
}, { flush: 'sync' });
watch(state, value => emit('recording', value !== 'idle'));
watch(() => props.disabled, value => { if (value) cancel(); });
function selectFile(event) { file(event.target.files?.[0]); event.target.value = ''; }
onBeforeUnmount(() => { clearInterval(clock); dispose(); });
</script>
<template>
  <div class="voice-input">
    <div class="voice-actions"><button type="button" :disabled="disabled || state === 'requesting' || state === 'transcribing'" @click="state === 'recording' ? finish() : start()">{{ state === 'recording' ? '说完了，开始识别' : state === 'requesting' ? '等待麦克风…' : state === 'transcribing' ? '正在识别…' : label }}</button><button v-if="busy" type="button" @click="cancel">取消</button><button v-else type="button" :disabled="disabled" @click="input?.click()">选择录音</button></div>
    <input ref="input" type="file" accept="audio/*,video/mp4" hidden @change="selectFile" />
    <div v-if="state === 'recording'" class="voice-timer"><progress :value="elapsed" max="30" aria-label="录音时长" :aria-valuetext="`已录${elapsed}秒，还可录${30 - elapsed}秒`" /><span aria-hidden="true">已录 {{ elapsed }} 秒 · 剩 {{ 30 - elapsed }} 秒</span></div>
    <p v-if="statusText" role="status" aria-live="polite">{{ statusText }}</p><p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>
<style scoped>
.voice-input { min-width: 0; font-size: 14px; }.voice-actions { display:flex; flex-wrap:wrap; gap:8px; }.voice-actions button { min-height:44px; border:1px solid #b9d2c5; border-radius:12px; background:#eef6f0; color:#205747; padding:8px 12px; font:inherit; font-weight:650; }.voice-actions button:disabled { opacity:.55; }.voice-input p { margin:6px 0; color:#865026; line-height:1.5; }
.voice-timer { display:flex; align-items:center; gap:10px; margin-top:8px; color:#205747; font-variant-numeric:tabular-nums; }.voice-timer progress { flex:1; min-width:0; max-width:240px; height:10px; accent-color:#24685b; }.voice-timer span { white-space:nowrap; }
</style>
