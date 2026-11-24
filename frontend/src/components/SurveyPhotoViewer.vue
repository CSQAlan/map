<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
const props = defineProps({ photos: { type: Array, default: () => [] }, initialIndex: { type: Number, default: -1 }, apiBaseUrl: { type: String, required: true } });
const emit = defineEmits(['close']);
const dialog = ref(null);
const index = ref(-1);
const failed = ref(false);
const attempt = ref(0);
const photo = computed(() => props.photos[index.value]);
let opener;
let disposed = false;

watch(() => props.initialIndex, async value => {
  index.value = value;
  failed.value = false;
  attempt.value = 0;
  await nextTick();
  if (disposed) return;
  if (value < 0 || !photo.value) { dialog.value?.close(); return; }
  if (!dialog.value.open) {
    opener = document.activeElement;
    dialog.value.showModal();
    document.body.classList.add('survey-viewer-open');
  }
}, { immediate: true });
watch(index, () => { failed.value = false; attempt.value = 0; });
function close() { dialog.value?.close(); }
function backdropClick(event) { if (event.target === dialog.value) close(); }
function closed() {
  document.body.classList.remove('survey-viewer-open');
  emit('close');
  if (opener?.isConnected) opener.focus();
}
function move(delta) { if (props.photos.length) index.value = (index.value + delta + props.photos.length) % props.photos.length; }
function keydown(event) {
  if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
  if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
}
onBeforeUnmount(() => { disposed = true; dialog.value?.close(); document.body.classList.remove('survey-viewer-open'); });
</script>

<template>
  <dialog ref="dialog" class="survey-photo-viewer" aria-label="踩点照片大图" @close="closed" @keydown="keydown" @click="backdropClick">
    <div v-if="photo" class="survey-viewer-content">
      <header><span aria-live="polite">{{ index + 1 }} / {{ photos.length }}</span><button type="button" autofocus @click="close">关闭大图</button></header>
      <div class="survey-viewer-image">
        <img v-if="!failed" :key="`${index}-${attempt}`" :src="`${apiBaseUrl}${photo.display_url}${attempt ? `?retry=${attempt}` : ''}`" :alt="photo.caption" @error="failed = true" />
        <div v-else class="survey-photo-unavailable" role="status"><p>照片暂时无法加载</p><button type="button" @click="attempt++; failed = false">重试大图</button></div>
      </div>
      <p>{{ photo.caption }}</p>
      <footer v-if="photos.length > 1"><button type="button" @click="move(-1)">上一张</button><button type="button" @click="move(1)">下一张</button></footer>
    </div>
  </dialog>
</template>
