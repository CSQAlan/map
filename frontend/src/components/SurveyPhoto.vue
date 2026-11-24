<script setup>
import { ref, watch } from 'vue';
const props = defineProps({ photo: { type: Object, required: true }, apiBaseUrl: { type: String, required: true } });
const emit = defineEmits(['open']);
const failed = ref(false);
const attempt = ref(0);
watch(() => props.photo.thumbnail_url, () => { failed.value = false; attempt.value = 0; });
function retry() { attempt.value++; failed.value = false; }
</script>

<template>
  <figure class="survey-evidence-photo">
    <button v-if="!failed" type="button" class="survey-photo-open" :aria-label="`查看大图：${photo.caption}`" @click="emit('open')">
      <img :key="attempt" :src="`${apiBaseUrl}${photo.thumbnail_url}${attempt ? `?retry=${attempt}` : ''}`" :alt="photo.caption" loading="lazy" @error="failed = true" />
      <span>查看大图</span>
    </button>
    <div v-else class="survey-photo-unavailable" role="status">
      <span>照片暂时无法加载</span>
      <button type="button" @click="retry">重试照片</button>
    </div>
    <figcaption><span>{{ photo.kind === 'map_reference' ? '地图参考图' : '现场照片' }}</span><strong>{{ photo.caption }}</strong></figcaption>
  </figure>
</template>
