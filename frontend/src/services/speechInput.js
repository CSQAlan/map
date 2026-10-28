import { ref } from 'vue';
import { API_BASE_URL } from '../config/api.js';

export async function transcribeAudio(blob, { signal } = {}) {
  if (!blob?.size || blob.size > 5 * 1024 * 1024) throw new Error('请选择5MB以内、30秒以内的录音。');
  const form = new FormData(); form.append('audio', blob, blob.name || (blob.type.includes('mp4') ? 'recording.m4a' : 'recording.webm'));
  const response = await fetch(`${API_BASE_URL}/api/speech/transcribe`, { method: 'POST', body: form, signal });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : '语音识别失败，请稍后重试。');
  if (!result.text?.trim()) throw new Error('没有识别到文字，请重新录音。');
  return result.text.trim();
}

export function createSpeechInput({ onText, upload = transcribeAudio, mediaDevices = globalThis.navigator?.mediaDevices, Recorder = globalThis.MediaRecorder, secure = globalThis.isSecureContext, schedule = setTimeout, unschedule = clearTimeout } = {}) {
  const state = ref('idle'); const error = ref(''); let revision = 0; let recorder; let stream; let timer; let controller;
  function release() { unschedule(timer); timer = null; stream?.getTracks().forEach(track => track.stop()); stream = null; }
  function cancel() { revision++; controller?.abort(); controller = null; const old = recorder; recorder = null; if (old?.state !== 'inactive') { try { old?.stop(); } catch {} } release(); state.value = 'idle'; }
  async function recognize(blob, id) {
    controller = new AbortController(); state.value = 'transcribing';
    try { const text = await upload(blob, { signal: controller.signal }); if (id === revision) onText?.(text); }
    catch (e) { if (id === revision && e.name !== 'AbortError') error.value = e instanceof TypeError ? '连接不到语音服务，请检查电脑上的后端后重试。' : e.message || '识别失败，请重试。'; }
    finally { if (id === revision) { state.value = 'idle'; controller = null; } }
  }
  function finish() { if (state.value !== 'recording') return; unschedule(timer); state.value = 'transcribing'; try { recorder.stop(); } catch { cancel(); error.value = '录音停止失败，请重新录制。'; } }
  async function start() {
    if (state.value !== 'idle') return;
    error.value = '';
    if (!secure || !mediaDevices?.getUserMedia || !Recorder) { error.value = '录音需要HTTPS或本机localhost；也可选择已有录音。'; return; }
    const id = ++revision; state.value = 'requesting';
    try {
      const acquired = await mediaDevices.getUserMedia({ audio: true });
      if (id !== revision) { acquired.getTracks().forEach(t => t.stop()); return; }
      stream = acquired;
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => Recorder.isTypeSupported?.(type));
      const active = new Recorder(stream, mimeType ? { mimeType } : undefined); recorder = active; const chunks = []; let bytes = 0;
      active.ondataavailable = event => { if (event.data.size && id === revision) { bytes += event.data.size; chunks.push(event.data); if (bytes > 5 * 1024 * 1024) { cancel(); error.value = '录音超过5MB，请缩短录音。'; } } };
      active.onerror = () => { if (id === revision) { cancel(); error.value = '录音失败，请检查麦克风后重试。'; } };
      active.onstop = () => { if (id !== revision) return; release(); recorder = null; void recognize(new Blob(chunks, { type: active.mimeType || 'audio/webm' }), id); };
      active.start(500); state.value = 'recording'; timer = schedule(finish, 30000);
    } catch (e) { if (id === revision) { cancel(); error.value = e.name === 'NotAllowedError' ? '麦克风权限未开启，可在浏览器设置中允许，或选择录音。' : '无法启动录音，请检查麦克风。'; } }
  }
  function file(blob) { cancel(); error.value = ''; if (blob) void recognize(blob, revision); }
  return { state, error, start, finish, cancel, file, dispose: cancel };
}
