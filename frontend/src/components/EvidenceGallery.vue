<script setup>
import { ref } from 'vue';

import PhotoLightbox from './PhotoLightbox.vue';

const props = defineProps({
  feature: { type: Object, default: null },
  routeFeatures: { type: Array, default: () => [] },
  apiBaseUrl: { type: String, required: true },
});

const emit = defineEmits(['select-segment']);
const lightboxIndex = ref(-1);

function resolveUrl(url) {
  return url?.startsWith('/') ? `${props.apiBaseUrl}${url}` : url;
}

function markImageFailed(event) {
  event.target.closest('.evidence-photo')?.classList.add('image-failed');
}
</script>

<template>
  <section class="evidence-section" aria-live="polite">
    <div class="panel-heading compact">
      <p class="section-kicker">现场照片证据</p>
      <h2>路线沿途真实环境</h2>
    </div>

    <div v-if="routeFeatures.length" class="route-evidence-strip">
      <button
        v-for="item in routeFeatures"
        :key="item.properties.segment_code"
        type="button"
        :class="['route-evidence-card', { active: feature?.properties.segment_code === item.properties.segment_code }]"
        @click="emit('select-segment', item.properties.segment_code)"
      >
        <img
          v-if="item.properties.evidence_photos?.[0]"
          :src="resolveUrl(item.properties.evidence_photos[0].thumbnail_url)"
          :alt="item.properties.evidence_photos[0].caption"
          width="160"
          height="104"
          loading="lazy"
        />
        <span v-else class="evidence-placeholder">暂无照片</span>
        <strong>{{ item.properties.name }}</strong>
        <small>{{ item.properties.risk_summary }}</small>
      </button>
    </div>

    <article v-if="feature" class="selected-evidence-card">
      <div class="evidence-summary">
        <div>
          <span>当前路段</span>
          <h3>{{ feature.properties.name }}</h3>
          <p>{{ feature.properties.risk_summary }}</p>
        </div>
        <dl>
          <div><dt>安全</dt><dd>{{ feature.properties.safety_level }}/5</dd></div>
          <div><dt>无障碍</dt><dd>{{ feature.properties.barrier_free_level }}/5</dd></div>
          <div><dt>可信度</dt><dd>{{ feature.properties.data_confidence }}/5</dd></div>
        </dl>
      </div>

      <div v-if="feature.properties.evidence_photos?.length" class="evidence-photo-grid">
        <button
          v-for="(photo, index) in feature.properties.evidence_photos"
          :key="photo.photo_id"
          class="evidence-photo"
          type="button"
          @click="lightboxIndex = index"
        >
          <img
            :src="resolveUrl(photo.thumbnail_url)"
            :alt="photo.caption"
            width="240"
            height="160"
            loading="lazy"
            @error="markImageFailed"
          />
          <span class="evidence-image-fallback">照片暂不可用</span>
          <strong>{{ photo.caption }}</strong>
          <small v-if="photo.risk_tags.length">{{ photo.risk_tags.join(' · ') }}</small>
        </button>
      </div>
      <p v-else class="evidence-empty">该路段暂未登记现场照片，路线数据仍可正常使用。</p>
    </article>
    <p v-else class="evidence-empty">点击地图上的道路或路线照片，查看对应现场证据。</p>

    <PhotoLightbox
      :photos="feature?.properties.evidence_photos ?? []"
      :initial-index="lightboxIndex"
      :api-base-url="apiBaseUrl"
      @close="lightboxIndex = -1"
    />
  </section>
</template>
