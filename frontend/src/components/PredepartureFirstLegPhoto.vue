<script setup>
import { nextTick, onBeforeUnmount, ref, shallowRef, watch, reactive } from 'vue';
import { buildNavigationPhotoCue } from '../utils/navigationPhotoCue.js';

const props = defineProps({
  routeSource: { type: Object, default: null },
  mapFeatures: { type: Array, default: () => [] },
  apiBaseUrl: { type: String, default: '' },
  scope: { type: [Number, String], default: 0 },
  pilotArea: { type: Object, default: null },
});
const opener = ref(null), closeButton = ref(null), preview = shallowRef(null);
let version = 0, alive = true;
function clear() { version++; preview.value = null; }
watch([() => props.routeSource, () => props.mapFeatures, () => props.apiBaseUrl,
  () => props.scope, () => props.pilotArea], clear, { deep: true, flush: 'sync' });
onBeforeUnmount(() => { alive = false; clear(); });

async function open() {
  if (!props.routeSource || preview.value) return;
  const cue = buildNavigationPhotoCue(props.routeSource, props.mapFeatures, 0,
    { verifiedOrdinary: true, apiBaseUrl: props.apiBaseUrl });
  // Never search for a photo: only segment_codes[0], then its first exact record.
  const first = cue.steps[0], photo = first?.photos[0] ?? null;
  const request = reactive({ id: ++version, name: first?.name ?? '', photo,
    reason: cue.available ? first?.reason ?? '' : cue.reason, status: photo ? 'loading' : 'empty',
    onLoad: () => settle('loaded'), onError: () => settle('failed') });
  function settle(status) {
    if (alive && preview.value === request && request.id === version && request.status === 'loading')
      request.status = status;
  }
  preview.value = request;
  await nextTick();
  if (alive && preview.value === request) closeButton.value?.focus();
}
async function close() {
  clear(); const closedVersion = version;
  await nextTick();
  if (alive && version === closedVersion && !preview.value) opener.value?.focus();
}
</script>

<template>
  <section v-if="routeSource" class="predeparture-first-leg" aria-label="出发前首段登记照片">
    <button ref="opener" class="secondary-action" type="button" :aria-expanded="Boolean(preview)"
      aria-controls="predeparture-photo-preview" @click="open">出发前看首段实景</button>
    <section v-if="preview" id="predeparture-photo-preview" class="predeparture-photo-preview"
      data-testid="predeparture-photo-preview" aria-labelledby="predeparture-photo-title" @keydown.esc.stop.prevent="close">
      <h2 id="predeparture-photo-title">所选路线的首段登记实景</h2>
      <p v-if="preview.name"><strong>首段：{{ preview.name }}</strong></p>
      <p>登记照片，只用于认路，不代表现状或当前位置。</p>
      <p>照片朝向、出发方向及入口未确认，请自行核对现场。</p>
      <figure v-if="preview.photo">
        <img v-if="preview.status !== 'failed'" :key="preview.id" :src="preview.photo.url"
          :alt="preview.photo.caption" referrerpolicy="no-referrer" decoding="async"
          data-testid="predeparture-photo-image" v-on="{ load: preview.onLoad, error: preview.onError }">
        <figcaption>{{ preview.photo.caption }}</figcaption>
      </figure>
      <p role="status">
        <template v-if="preview.status === 'loading'">登记照片正在加载…</template>
        <template v-else-if="preview.status === 'failed'">首段登记照片加载失败，无法展示。请核对现场；不会换用其他照片或路段。</template>
        <template v-else-if="!preview.photo">{{ preview.reason }}不会换用后续路段照片。</template>
      </p>
      <button ref="closeButton" class="secondary-action" type="button" @click="close">关闭首段实景</button>
    </section>
  </section>
</template>

<style scoped>
.predeparture-first-leg { min-width: 0; margin-block: 1rem; }
.predeparture-photo-preview { min-width: 0; margin-top: .75rem; padding: 1rem; border: 2px solid #526d53; border-radius: .75rem; background: #f5f8ef; color: #233425; }
.predeparture-first-leg button { min-height: 48px; min-width: 48px; max-width: 100%; white-space: normal; overflow-wrap: anywhere; font-size: 1rem; line-height: 1.5; }
.predeparture-photo-preview h2 { font-size: 1.2rem; line-height: 1.5; }
.predeparture-photo-preview p, .predeparture-photo-preview figcaption { font-size: 1rem; line-height: 1.65; overflow-wrap: anywhere; }
.predeparture-photo-preview figure { min-width: 0; margin: 1rem 0; }
.predeparture-photo-preview img { display: block; max-width: 100%; width: 100%; height: auto; border-radius: .5rem; }
.predeparture-photo-preview figcaption { margin-top: .5rem; }
.predeparture-first-leg button:focus-visible { outline: 3px solid #254e8c; outline-offset: 3px; }
</style>
