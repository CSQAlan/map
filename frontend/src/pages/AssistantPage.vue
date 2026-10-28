<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { createAssistant } from '../composables/useAssistant.js';
import AppIcon from '../components/ui/AppIcon.vue';
const props = defineProps({ routeContext: { type: Object, default: null } });
const { messages, draft, loading, error, status, checking, checkStatus, send, cancel, clear, dispose } = createAssistant();
const includeContext = ref(false);
const conversationEnd = ref(null);
const hasRoute = computed(() => Boolean(props.routeContext?.summary || props.routeContext?.destination));
const prompts = ['怎么选择适合自己的路线？', '轮椅出行前，要留意哪些事？', '怎么把出行情况告诉家人？'];
async function submit(text = draft.value) { await send(text, includeContext.value ? props.routeContext : null); }
watch(() => [messages.value.length, loading.value], async () => {
  await nextTick();
  if (messages.value.length) conversationEnd.value?.scrollIntoView({ block: 'nearest' });
});
onMounted(checkStatus);
onBeforeUnmount(dispose);
</script>

<template>
  <section class="assistant-page">
    <header class="assistant-heading"><div><p>出门前，聊一聊</p><h1>您的出行小助手</h1></div><button v-if="messages.length" class="assistant-clear" type="button" @click="clear"><AppIcon name="plus" :size="18" />新对话</button></header>
    <div class="assistant-connection" :class="{ 'is-offline': status && !status.available }" role="status"><span class="connection-dot"></span><span>{{ checking ? '正在连接本地助手…' : status?.message || '本地助手' }}</span><button type="button" :disabled="checking" aria-label="重新检查助手连接" @click="checkStatus"><AppIcon name="refresh" :size="16" /></button></div>
    <div v-if="!messages.length" class="assistant-welcome" role="region" aria-label="助手介绍与快捷提问" tabindex="0">
      <div class="assistant-emblem"><AppIcon name="chat" :size="40" /><span><AppIcon name="leaf" :size="18" /></span></div>
      <h2>路上的小疑问，<br />我们一起想一想。</h2><p>帮您看懂路线，了解出行注意事项，<br />也可以教您使用助老地图。</p>
      <div class="assistant-prompts"><button v-for="prompt in prompts" :key="prompt" type="button" :disabled="loading" @click="submit(prompt)"><AppIcon name="chat" :size="19" /><span>{{ prompt }}</span><AppIcon name="arrow" :size="18" /></button></div>
    </div>
    <div v-else class="assistant-conversation" role="log" tabindex="0" aria-label="与出行助手的对话" aria-live="polite" aria-relevant="additions text">
      <article v-for="(message, index) in messages" :key="index" class="chat-turn" :class="`chat-turn--${message.role}`"><span class="chat-speaker">{{ message.role === 'user' ? '您' : '出行小助手' }}</span><p>{{ message.content }}</p></article>
      <p v-if="loading" class="assistant-thinking" role="status"><span class="thinking-dot"></span>正在为您整理回答…</p><div ref="conversationEnd"></div>
    </div>
    <div class="assistant-composer">
      <label class="assistant-context"><input v-model="includeContext" type="checkbox" :disabled="loading || !hasRoute" /><span>附带当前路线摘要</span><small>{{ hasRoute ? '仅含地点、出行方式和路线说明' : '查询路线后可使用' }}</small></label>
      <p v-if="includeContext && hasRoute" class="assistant-context-preview">{{ routeContext.start }} → {{ routeContext.destination }} · {{ routeContext.mobility }}</p>
      <p v-if="error" class="assistant-error" role="alert">{{ error }} 问题已保留，可修改后重新发送。</p>
      <form class="assistant-input-box" @submit.prevent="submit()"><label class="sr-only" for="assistant-question">向出行助手提问</label><textarea id="assistant-question" v-model="draft" rows="2" maxlength="1000" :disabled="loading" placeholder="说说您想了解什么…" enterkeyhint="enter"></textarea><button v-if="loading" class="assistant-send" type="button" aria-label="取消等待" @click="cancel"><AppIcon name="close" :size="21" /></button><button v-else class="assistant-send" type="submit" :disabled="!draft.trim()" aria-label="发送问题"><AppIcon name="send" :size="21" /></button></form>
      <p class="assistant-footnote">AI 回答供参考，实际出行请以现场情况与路线页面为准。<span>{{ draft.length }}/1000</span></p>
    </div>
  </section>
</template>

<style scoped>
.assistant-page { max-width: 780px; margin: 0 auto; height: calc(100dvh - 180px); min-height: 360px; display: flex; flex-direction: column; }
.assistant-heading, .assistant-connection, .assistant-composer { flex: 0 0 auto; }
.assistant-welcome, .assistant-conversation { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior-y: contain; scrollbar-width: thin; padding-inline: 2px; }
.assistant-heading { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 0 18px; }
.assistant-heading p { margin: 0 0 8px; color: #718078; font-size: 13px; }
.assistant-heading h1 { margin: 0; font-size: 27px; letter-spacing: -.7px; }
.assistant-clear { display: inline-flex; align-items: center; gap: 4px; border: 0; padding: 6px 8px; background: transparent; color: #507560; font-size: 13px; }
.assistant-connection { display: flex; align-items: center; gap: 8px; padding: 5px 12px; background: #e7f1e9; color: #48705a; border-radius: 12px; font-size: 12px; }
.assistant-connection > span:nth-child(2) { flex: 1; }
.connection-dot { width: 6px; height: 6px; flex: 0 0 auto; border-radius: 50%; background: #548d64; }
.assistant-connection button { min-width: 44px; min-height: 44px; display: grid; place-items: center; padding: 0; color: inherit; background: transparent; border: 0; }
.assistant-connection.is-offline { color: #8b6540; background: #fbf2e8; }
.is-offline .connection-dot { background: #a27b50; }
.assistant-welcome { padding: 20px 2px 24px; text-align: center; }
.assistant-emblem { display: grid; place-items: center; position: relative; width: 82px; height: 82px; margin: 0 auto 20px; border: 1px solid #d9e6dc; border-radius: 29px; background: #e7f0e8; color: #3a7055; }
.assistant-emblem > span { position: absolute; right: -5px; bottom: -5px; padding: 5px; background: #f8fbf8; border: 3px solid #f4f7f5; border-radius: 50%; display: flex; }
.assistant-welcome h2 { font-size: 26px; line-height: 1.6; font-weight: 650; letter-spacing: -.3px; margin: 0 0 12px; }
.assistant-welcome > p { font-size: 14px; line-height: 1.9; color: #748075; margin: 0; }
.assistant-prompts { display: grid; gap: 10px; margin-top: 20px; text-align: left; }
.assistant-prompts button { display: flex; align-items: center; gap: 10px; min-height: 60px; padding: 12px 16px; border: 1px solid #e0e8e1; border-radius: 15px; background: white; color: #52715c; text-align: left; font-size: 14px; }
.assistant-prompts button > span { flex: 1; color: #35513e; }
.assistant-conversation { padding: 22px 2px; display: flex; flex-direction: column; gap: 20px; }
.chat-turn--user { align-self: flex-end; }
.chat-turn { max-width: 92%; justify-self: start; }
.chat-speaker { display: block; font-size: 12px; color: #7b887e; margin: 0 0 6px 4px; }
.chat-turn p { margin: 0; background: white; border: 1px solid #e0e8e1; border-radius: 5px 18px 18px; padding: 16px; font-size: 16px; line-height: 1.9; white-space: pre-wrap; overflow-wrap: anywhere; }
.chat-turn--user { justify-self: end; }
.chat-turn--user .chat-speaker { text-align: right; }
.chat-turn--user p { background: #e3eee5; border-color: #d9e6dc; border-radius: 18px 5px 18px 18px; }
.assistant-thinking { display: flex; align-items: center; gap: 8px; color: #718078; font-size: 14px; }
.thinking-dot { width: 7px; height: 7px; border-radius: 50%; background: #78a285; }
.assistant-composer { border-top: 1px solid #e2e9e3; padding-top: 16px; }
.assistant-context { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; min-height: 44px; color: #536d5b; font-size: 13px; cursor: pointer; }
.assistant-context input { width: 18px; height: 18px; min-height: 0; accent-color: #24685b; }
.assistant-context small { font-size: 11px; color: #7d8b80; }
.assistant-context-preview { padding: 10px; margin: 0 0 10px; background: #e9f0e9; border-radius: 8px; font-size: 12px; }
.assistant-input-box { display: flex; gap: 8px; align-items: flex-end; border: 1px solid #cbdcd0; border-radius: 19px; background: #fff; padding: 10px; }
.assistant-input-box:focus-within { outline: 2px solid #4e8967; outline-offset: 2px; }
.assistant-input-box textarea { width: 100%; min-width: 0; min-height: 65px; max-height: 180px; resize: vertical; padding: 7px; border: 0; background: transparent; font-size: 16px; line-height: 1.6; box-shadow: none; outline: none; }
.assistant-send { display: grid; place-items: center; flex: 0 0 auto; width: 48px; height: 48px; background: #24685b; color: white; border: 0; border-radius: 14px; }
.assistant-send:disabled { background: #dbe6de; color: #8b9e8f; opacity: 1; }
.assistant-error { padding: 12px; border-radius: 12px; background: #fbefea; color: #904f3d; font-size: 14px; line-height: 1.7; }
.assistant-footnote { display: flex; justify-content: space-between; gap: 8px; margin: 10px 3px; color: #7d897f; font-size: 11px; line-height: 1.8; }
.assistant-footnote span { white-space: nowrap; }
@media (max-width: 767px) { .assistant-emblem { width: 54px; height: 54px; border-radius: 19px; margin-bottom: 12px; } .assistant-emblem > svg { width: 29px; height: 29px; } .assistant-welcome h2 { font-size: 22px; line-height: 1.4; margin-bottom: 8px; } .assistant-welcome > p { font-size: 12px; line-height: 1.7; } .assistant-prompts { gap: 8px; margin-top: 14px; } .assistant-prompts button { min-height: 48px; padding: 10px 12px; font-size: 13px; } .assistant-prompts button:nth-child(3) { display: none; } .assistant-welcome { padding-block: 14px; } }
@media (min-width: 768px) { .assistant-page { height: calc(100dvh - 150px); min-height: 520px; } .assistant-welcome { padding-top: 45px; } .assistant-prompts { max-width: 470px; margin-inline: auto; } .assistant-heading h1 { font-size: 32px; } }
@media (max-height: 600px) and (max-width: 767px) { .assistant-page { min-height: 0; height: calc(100dvh - 170px); } .assistant-heading p { display: none; } .assistant-heading { padding: 0 0 10px; } .assistant-heading h1 { font-size: 22px; } .assistant-input-box textarea { height: 50px; min-height: 50px; } .assistant-context { min-height: 36px; } .assistant-footnote { font-size: 10px; line-height: 1.3; } }
</style>
