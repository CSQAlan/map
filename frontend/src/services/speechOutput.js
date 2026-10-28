import { ref } from 'vue';
export function createSpeechOutput({ synthesis = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance } = {}) {
  const playing = ref(false); const error = ref(''); let revision = 0;
  function stop() { revision++; synthesis?.cancel(); playing.value = false; }
  function speak(text) {
    stop(); error.value = '';
    if (!synthesis || !Utterance) { error.value = '当前设备不支持语音播报，请查看文字提示。'; return false; }
    if (!text?.trim()) return false;
    const id = revision; const utterance = new Utterance(text.replace(/[*#`]/g, '').slice(0, 3500));
    const voices = synthesis.getVoices().filter(voice => /^zh/i.test(voice.lang));
    utterance.voice = voices.find(voice => voice.localService) || voices[0] || null;
    utterance.lang = 'zh-CN'; utterance.rate = 0.85;
    utterance.onend = () => { if (id === revision) playing.value = false; };
    utterance.onerror = () => { if (id === revision) { playing.value = false; error.value = '播报未完成，请重试或查看文字提示。'; } };
    try { playing.value = true; synthesis.speak(utterance); return true; } catch { playing.value = false; error.value = '无法播放语音，请查看文字提示。'; return false; }
  }
  return { playing, error, speak, stop };
}
export function buildSegmentInstruction(segment, index = 0, count = 1) {
  if (!segment) return '请先选择一条路线。';
  const parts = [`第${index + 1}段，共${count}段。${segment.name}。`, segment.explanation || `请沿${segment.name}慢行，留意现场情况。`];
  if (segment.step_count > 0) parts.push(`前方有${segment.step_count}级台阶，请注意脚下。${segment.has_ramp ? '路段记录有坡道，请现场确认入口。' : ''}`);
  if (segment.risk_tags?.length) parts.push(`注意：${[...new Set(segment.risk_tags)].join('、')}。`);
  if (index === count - 1) parts.push('这是最后一段，到达后请核对目的地，再结束导航。');
  return parts.join('');
}
