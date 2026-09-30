<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import SurveyRecordsMap from '../components/SurveyRecordsMap.vue';
import { useSurveyRecords } from '../composables/useSurveyRecords.js';

const props = defineProps({
  apiBaseUrl: { type: String, required: true },
  accessToken: { type: String, required: true },
});
const emit = defineEmits(['back']);
const {
  sites, features, selectedSiteCode, selectedRecordCode, pendingCoordinate, saving, loading,
  message, errorMessage, siteError, selectedFeature, selectedPhotos: selectedMedia,
  allLocatedCenter, loadSites, loadRecords, selectRecord, saveLocation,
} = useSurveyRecords({ apiBaseUrl: props.apiBaseUrl, accessToken: () => props.accessToken });
const mapFailure = ref('');
const lightboxPhoto = ref(null);

onMounted(async () => {
  window.addEventListener('keydown', handleLightboxKeydown);
  await loadSites();
  await loadRecords();
});
onBeforeUnmount(() => window.removeEventListener('keydown', handleLightboxKeydown));

function handleLightboxKeydown(event) {
  if (event.key === 'Escape') lightboxPhoto.value = null;
}
</script>

<template>
  <main class="admin-survey-page">
    <header class="admin-survey-header">
      <div><p class="section-kicker">管理员后台 / 踩点资料</p><h1>对照照片补充位置</h1></div>
      <button type="button" class="secondary-action" @click="emit('back')">返回管理后台</button>
    </header>
    <p class="survey-safety-notice"><strong>只保存位置，不审核资料。</strong><span>位置仍需复核，不会进入路线推荐。</span></p>
    <label class="survey-site-select admin-survey-site"><span>地点筛选</span><select v-model="selectedSiteCode"><option value="">全部 7 个地点</option><option v-for="site in sites" :key="site.site_code" :value="site.site_code">{{ site.name }}</option></select></label>
    <p v-if="loading" class="survey-loading" role="status">正在读取记录…</p>
    <p v-if="errorMessage" class="survey-error" role="alert">{{ errorMessage }}</p>
    <p v-if="siteError" class="survey-error" role="alert">{{ siteError }}</p>
    <p v-if="mapFailure" class="survey-map-warning" role="status">地图暂不可用：{{ mapFailure }}</p>
    <div v-if="message" class="survey-success" role="status">{{ message }}</div>

    <section class="admin-survey-workspace">
      <aside class="admin-survey-records">
        <h2>选择记录 <span>{{ features.length }}</span></h2>
        <button v-for="feature in features" :key="feature.properties.record_code" type="button" :class="['survey-record-card', { active: selectedRecordCode === feature.properties.record_code }]" @click="selectRecord(feature.properties.record_code)">
          <span :class="['survey-card-mark', feature.geometry ? 'located' : 'unlocated']">{{ feature.geometry ? '!' : '?' }}</span>
          <span class="survey-card-copy"><strong>{{ feature.properties.title }}</strong><small>{{ feature.properties.site_name }} · {{ feature.geometry ? '已有 GPS/标注' : '待定位' }}</small></span>
        </button>
      </aside>

      <div class="admin-survey-map-column">
        <SurveyRecordsMap
          :features="features"
          :center="allLocatedCenter"
          :selected-record-code="selectedRecordCode"
          :placement-mode="true"
          :pending-coordinate="pendingCoordinate"
          @select-record="selectRecord"
          @map-error="mapFailure = $event"
          @map-click="pendingCoordinate = $event; message = ''; errorMessage = ''"
        />
        <div v-if="selectedFeature" class="admin-survey-selected">
          <div class="admin-survey-selected-heading"><div><p class="section-kicker">{{ selectedFeature.properties.site_name }}</p><h2>{{ selectedFeature.properties.title }}</h2></div><span class="survey-pending-badge">待核查</span></div>
          <p class="survey-location-label">{{ selectedFeature.geometry ? '橙色＋标记是待保存位置；单击地图可移动。' : '搜索地点后，单击地图放置位置。' }}</p>
          <div class="survey-photo-grid admin-survey-photos">
            <button v-for="photo in selectedMedia" :key="photo.photo_id" type="button" class="survey-photo-card" @click="lightboxPhoto = photo">
              <img :src="`${props.apiBaseUrl}${photo.thumbnail_url}`" :alt="photo.caption" loading="lazy" />
              <span>{{ photo.kind === 'map_reference' ? '地图截图' : '现场照片' }}</span><strong>{{ photo.caption }}</strong>
            </button>
          </div>
          <div class="admin-survey-actions">
            <span v-if="pendingCoordinate" class="survey-coord-readout">已选择地图位置</span>
            <span v-else class="survey-coord-readout">尚未选择位置</span>
            <button type="button" :disabled="!pendingCoordinate || saving" @click="saveLocation">{{ saving ? '正在保存…' : '保存位置（仍待核查）' }}</button>
          </div>
        </div>
        <div v-else class="survey-empty-card">当前地点没有记录。</div>
      </div>
    </section>
    <div v-if="lightboxPhoto" class="survey-lightbox" role="dialog" aria-modal="true" :aria-label="lightboxPhoto.caption" @click.self="lightboxPhoto = null">
      <button type="button" class="survey-lightbox-close" aria-label="关闭照片" @click="lightboxPhoto = null">×</button>
      <img :src="`${props.apiBaseUrl}${lightboxPhoto.display_url}`" :alt="lightboxPhoto.caption" />
      <p>{{ lightboxPhoto.kind === 'map_reference' ? '地图截图' : '现场照片' }} · {{ lightboxPhoto.caption }}</p>
    </div>
  </main>
</template>
