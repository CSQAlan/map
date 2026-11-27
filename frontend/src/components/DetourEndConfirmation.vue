<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps({ request: { type: Object, required: true } });
const emit = defineEmits(['dismiss', 'confirm']);
// Keep the identity even if a handler is queued beyond this dialog's lifetime.
const request = props.request;
const dialog = ref(null), keepButton = ref(null), endButton = ref(null);
onMounted(() => { dialog.value.showModal(); keepButton.value.focus(); });
onBeforeUnmount(() => dialog.value?.close());
function trapFocus(event) {
  if (event.key !== 'Tab') return;
  event.preventDefault();
  const next = event.shiftKey
    ? (document.activeElement === keepButton.value ? endButton.value : keepButton.value)
    : (document.activeElement === endButton.value ? keepButton.value : endButton.value);
  next.focus();
}
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="detour-end-dialog" aria-modal="true"
      aria-labelledby="detour-end-title" aria-describedby="detour-end-description"
      @keydown="trapFocus" @cancel.prevent="emit('dismiss', request)">
      <h2 id="detour-end-title">确认结束本次行程？</h2>
      <p id="detour-end-description">确认后将结束本次行程并清除绕行约束。结束行程不会自动确认已到达目的地。</p>
      <button ref="keepButton" type="button" autofocus @click="emit('dismiss', request)">保留行程</button>
      <button ref="endButton" type="button" @click="emit('confirm', request)">确认结束行程</button>
    </dialog>
  </Teleport>
</template>

<style scoped>
.detour-end-dialog { box-sizing:border-box; width:calc(100% - 2rem); max-width:30rem; max-height:calc(100dvh - 2rem); margin:auto; overflow:auto; overflow-wrap:anywhere; padding:24px; border:0; border-radius:22px; background:#fffdf7; color:#264d3b; font-size:1.25rem; line-height:1.8; box-shadow:0 20px 70px #0003; }
.detour-end-dialog::backdrop { background:#15291d88; }
.detour-end-dialog h2 { margin:0; font-size:1.5rem; }
.detour-end-dialog button { box-sizing:border-box; display:block; width:100%; min-width:0; min-height:48px; margin-top:10px; padding:10px 12px; border:1px solid #c9d6c9; border-radius:12px; background:#fff; color:inherit; font:inherit; font-size:1.125rem; font-weight:650; white-space:normal; overflow-wrap:anywhere; }
.detour-end-dialog button:focus-visible { outline:3px solid currentColor; outline-offset:3px; }
</style>
