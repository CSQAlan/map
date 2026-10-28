import { ref } from 'vue';
import { apiRequest } from '../services/apiClient.js';

export function createAssistant({ request = apiRequest } = {}) {
  const messages = ref([]);
  const draft = ref('');
  const loading = ref(false);
  const error = ref('');
  const status = ref(null);
  const checking = ref(false);
  let controller = null;
  let revision = 0;
  let statusRevision = 0;

  async function checkStatus() {
    const version = ++statusRevision;
    checking.value = true;
    try {
      const result = await request('/api/assistant/status');
      if (version === statusRevision) status.value = result;
    } catch {
      if (version === statusRevision) status.value = { available: false, message: '暂时连不上助手，请检查电脑上的后端和 Ollama 服务。' };
    } finally {
      if (version === statusRevision) checking.value = false;
    }
  }

  async function send(text = draft.value, context = null) {
    if (loading.value) return false;
    const content = text.trim();
    if (!content) return false;
    if (content.length > 1000) { error.value = '问题请控制在 1000 字以内。'; return false; }
    const previous = messages.value.slice(-12);
    const turn = { role: 'user', content };
    const version = ++revision;
    controller = new AbortController();
    loading.value = true;
    error.value = '';
    draft.value = '';
    messages.value = [...previous, turn];
    try {
      const result = await request('/api/assistant/chat', {
        method: 'POST',
        signal: controller.signal,
        body: { messages: [...previous, turn], ...(context ? { context } : {}) },
        errorMessage: '助手暂时无法回答，请稍后重试。',
      });
      if (version !== revision) return false;
      if (typeof result.reply !== 'string' || !result.reply.trim()) throw new Error('助手未返回内容，请重新发送。');
      messages.value = [...previous, turn, { role: 'assistant', content: result.reply.slice(0, 6000) }];
      statusRevision += 1;
      checking.value = false;
      status.value = { available: true, model: result.model, message: '本地助手已就绪' };
      return true;
    } catch (cause) {
      if (version !== revision) return false;
      messages.value = previous;
      if (!draft.value) draft.value = content;
      error.value = cause instanceof TypeError ? '连接中断，请检查电脑上的后端和 Ollama 服务后重试。' : cause.message || '助手暂时不可用，请重新发送。';
      return false;
    } finally {
      if (version === revision) { loading.value = false; controller = null; }
    }
  }

  function cancel() {
    revision += 1;
    controller?.abort();
    controller = null;
    if (loading.value && messages.value.at(-1)?.role === 'user') {
      const turn = messages.value.at(-1);
      messages.value = messages.value.slice(0, -1);
      if (!draft.value) draft.value = turn.content;
    }
    loading.value = false;
    error.value = '';
  }

  function clear() { cancel(); messages.value = []; draft.value = ''; }
  function dispose() { cancel(); statusRevision += 1; }
  return { messages, draft, loading, error, status, checking, checkStatus, send, cancel, clear, dispose };
}
