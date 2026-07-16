<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps({
  photos: { type: Array, default: () => [] },
  initialIndex: { type: Number, default: -1 },
  apiBaseUrl: { type: String, required: true },
});

const emit = defineEmits(['close']);
const currentIndex = ref(props.initialIndex);
const dialogRef = ref(null);
const closeButtonRef = ref(null);
let touchStartX = 0;
let opener = null;

watch(
  () => props.initialIndex,
  (index) => {
    currentIndex.value = index;
    if (index >= 0) {
      opener = document.activeElement;
      document.body.classList.add('lightbox-open');
      window.addEventListener('keydown', onKeydown);
      nextTick(() => closeButtonRef.value?.focus());
    } else {
      cleanup();
    }
  },
  { immediate: true }
);

onBeforeUnmount(cleanup);

function cleanup() {
  document.body.classList.remove('lightbox-open');
  window.removeEventListener('keydown', onKeydown);
}

function close() {
  cleanup();
  emit('close');
  nextTick(() => opener?.focus?.());
}

function move(delta) {
  if (!props.photos.length) return;
  currentIndex.value = (currentIndex.value + delta + props.photos.length) % props.photos.length;
}

function onKeydown(event) {
  if (event.key === 'Escape') close();
  if (event.key === 'ArrowLeft') move(-1);
  if (event.key === 'ArrowRight') move(1);
  if (event.key === 'Tab') trapFocus(event);
}

function trapFocus(event) {
  const focusable = [...(dialogRef.value?.querySelectorAll('button:not([disabled])') ?? [])];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function markImageFailed(event) {
  event.target.hidden = true;
  event.target.nextElementSibling.hidden = false;
}

function resolveUrl(url) {
  return url?.startsWith('/') ? `${props.apiBaseUrl}${url}` : url;
}

function finishSwipe(event) {
  const delta = event.changedTouches[0].clientX - touchStartX;
  if (Math.abs(delta) > 50) move(delta > 0 ? -1 : 1);
}
</script>

<template>
  <div
    v-if="currentIndex >= 0 && photos[currentIndex]"
    class="photo-lightbox"
    ref="dialogRef"
    role="dialog"
    aria-modal="true"
    aria-label="现场证据大图"
    @click.self="close"
  >
    <button ref="closeButtonRef" class="lightbox-close" type="button" aria-label="关闭大图" @click="close">关闭</button>
    <button v-if="photos.length > 1" class="lightbox-nav previous" type="button" @click="move(-1)">
      上一张
    </button>
    <figure @touchstart="touchStartX = $event.touches[0].clientX" @touchend="finishSwipe">
      <img
        :src="resolveUrl(photos[currentIndex].display_url)"
        :alt="photos[currentIndex].caption"
        @error="markImageFailed"
      />
      <span class="lightbox-image-fallback" hidden>现场照片暂不可用</span>
      <figcaption>
        <strong>{{ photos[currentIndex].caption }}</strong>
        <span v-if="photos[currentIndex].risk_tags?.length">
          风险：{{ photos[currentIndex].risk_tags.join('、') }}
        </span>
        <span>{{ currentIndex + 1 }} / {{ photos.length }}</span>
      </figcaption>
    </figure>
    <button v-if="photos.length > 1" class="lightbox-nav next" type="button" @click="move(1)">
      下一张
    </button>
  </div>
</template>
