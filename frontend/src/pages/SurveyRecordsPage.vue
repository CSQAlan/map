<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import SurveyRecordsMap from '../components/SurveyRecordsMap.vue';

const props = defineProps({ apiBaseUrl: { type: String, required: true } });
const sites = ref([]);
const features = ref([]);
const selectedSiteCode = ref('');
const selectedRecordCode = ref(null);
const selectedPhotoIndex = ref(0);
const loading = ref(false);
const errorMessage = ref('');
const mapFailure = ref('');
const lightboxPhoto = ref(null);

const selectedFeature = computed(() =>
  features.value.find((feature) => feature.properties.record_code === selectedRecordCode.value) ?? null
);
const selectedPhotos = computed(() => selectedFeature.value?.properties.evidence_photos ?? []);
const selectedPhoto = computed(() => selectedPhotos.value[selectedPhotoIndex.value] ?? null);
const allLocatedCenter = computed(() => {
  const points = features.value
    .map((feature) => feature.geometry?.coordinates)
    .filter((coordinates) => Array.isArray(coordinates) && coordinates.length >= 2);
  if (!points.length) return [];
  return [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  ];
});
const unlocatedFeatures = computed(() => features.value.filter((feature) => !feature.geometry));

onMounted(async () => {
  await loadSites();
  await loadRecords();
});

watch(selectedSiteCode, loadRecords);

async function loadSites() {
  try {
    const response = await fetch(`${props.apiBaseUrl}/api/survey-records/sites`);
    if (!response.ok) throw new Error('踩点地点暂时无法读取。');
    sites.value = await response.json();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '踩点地点暂时无法读取。';
  }
}

async function loadRecords() {
  loading.value = true;
  errorMessage.value = '';
  const query = new URLSearchParams({ coordinate_system: 'GCJ02' });
  if (selectedSiteCode.value) query.set('site_code', selectedSiteCode.value);
  try {
    const response = await fetch(`${props.apiBaseUrl}/api/survey-records?${query}`);
    if (!response.ok) throw new Error('踩点资料暂时无法读取，请确认后端已初始化。');
    const payload = await response.json();
    features.value = payload.features ?? [];
    if (!features.value.some((feature) => feature.properties.record_code === selectedRecordCode.value)) {
      selectedRecordCode.value = features.value[0]?.properties.record_code ?? null;
      selectedPhotoIndex.value = 0;
    }
  } catch (error) {
    features.value = [];
    errorMessage.value = error instanceof Error ? error.message : '踩点资料暂时无法读取。';
  } finally {
    loading.value = false;
  }
}

function selectRecord(recordCode) {
  selectedRecordCode.value = recordCode;
  selectedPhotoIndex.value = 0;
}

function movePhoto(step) {
  if (!selectedPhotos.value.length) return;
  selectedPhotoIndex.value = (selectedPhotoIndex.value + step + selectedPhotos.value.length) % selectedPhotos.value.length;
}
</script>

<template>
  <main class="survey-records-page">
    <header class="survey-page-header">
      <div>
        <p class="section-kicker">社区现场资料 · 独立展示</p>
        <h1>踩点资料地图</h1>
      </div>
      <label class="survey-site-select">
        <span>选择地点</span>
        <select v-model="selectedSiteCode" aria-label="按踩点地点筛选">
          <option value="">全部 7 个地点</option>
          <option v-for="site in sites" :key="site.site_code" :value="site.site_code">{{ site.name }}（{{ site.record_count }}）</option>
        </select>
      </label>
    </header>

    <div class="survey-safety-notice" role="note">
      <strong>待核查资料</strong>
      <span>照片和位置尚未审核，不用于路线推荐。请勿据此判断通行安全。</span>
    </div>

    <p v-if="errorMessage" class="survey-error" role="alert">{{ errorMessage }}</p>
    <p v-if="mapFailure" class="survey-map-warning" role="status">底图暂不可用，照片资料仍可查看：{{ mapFailure }}</p>
    <div v-if="loading" class="survey-loading" role="status">正在读取踩点记录…</div>

    <section class="survey-browser-layout" aria-label="地图与踩点记录">
      <div class="survey-map-column">
        <SurveyRecordsMap
          :features="features"
          :center="allLocatedCenter"
          :selected-record-code="selectedRecordCode"
          @select-record="selectRecord"
          @map-error="mapFailure = $event"
        />
        <div v-if="unlocatedFeatures.length" class="survey-unlocated-block">
          <h2>待定位记录 <span>{{ unlocatedFeatures.length }}</span></h2>
          <p>这些照片没有可用定位，先保留在列表中。</p>
          <div class="survey-record-list compact">
            <button v-for="feature in unlocatedFeatures" :key="feature.properties.record_code" type="button" :class="['survey-record-card', { active: selectedRecordCode === feature.properties.record_code }]" @click="selectRecord(feature.properties.record_code)">
              <span class="survey-card-mark">?</span>
              <span class="survey-card-copy"><strong>{{ feature.properties.title }}</strong><small>{{ feature.properties.site_name }} · 待定位</small></span>
            </button>
          </div>
        </div>
      </div>

      <aside class="survey-detail-column">
        <div v-if="selectedFeature" class="survey-detail-card">
          <div class="survey-detail-heading">
            <div><p class="section-kicker">{{ selectedFeature.properties.site_name }}</p><h2>{{ selectedFeature.properties.title }}</h2></div>
            <span class="survey-pending-badge">待核查</span>
          </div>
          <p class="survey-location-label">
            {{ selectedFeature.geometry ? (selectedFeature.properties.location_source === 'EXIF' ? '位置来自照片 GPS · 尚未核查' : '位置由管理员标注 · 尚未核查') : '暂无位置 · 待管理员补充' }}
          </p>
          <div v-if="selectedFeature.properties.issue_tags.length" class="survey-tags">
            <span v-for="tag in selectedFeature.properties.issue_tags" :key="tag">文件名关键词：{{ tag }}</span>
          </div>
          <div v-if="selectedPhotos.length" class="survey-photo-grid">
            <button v-for="(photo, index) in selectedPhotos" :key="photo.photo_id" type="button" class="survey-photo-card" @click="selectedPhotoIndex = index; lightboxPhoto = photo">
              <img :src="`${props.apiBaseUrl}${photo.thumbnail_url}`" :alt="photo.caption" loading="lazy" />
              <span>{{ photo.kind === 'map_reference' ? '配对地图截图' : '现场照片' }}</span>
              <strong>{{ photo.caption }}</strong>
            </button>
          </div>
          <p v-if="selectedFeature.properties.notes.length" class="survey-record-note">{{ selectedFeature.properties.notes.join('；') }}</p>
          <div v-if="selectedPhotos.length > 1" class="survey-photo-controls">
            <button type="button" @click="movePhoto(-1)">上一张</button>
            <span>{{ selectedPhotoIndex + 1 }} / {{ selectedPhotos.length }}</span>
            <button type="button" @click="movePhoto(1)">下一张</button>
          </div>
        </div>
        <div v-else class="survey-empty-card">{{ features.length ? '选择一条记录查看照片。' : '当前筛选下暂无记录。' }}</div>

        <div class="survey-count-summary"><strong>{{ features.length }}</strong><span>条踩点记录</span><strong>{{ unlocatedFeatures.length }}</strong><span>条待定位</span></div>
      </aside>
    </section>

    <div v-if="lightboxPhoto" class="survey-lightbox" role="dialog" aria-modal="true" :aria-label="lightboxPhoto.caption" @click.self="lightboxPhoto = null">
      <button type="button" class="survey-lightbox-close" aria-label="关闭照片" @click="lightboxPhoto = null">×</button>
      <img :src="`${props.apiBaseUrl}${lightboxPhoto.display_url}`" :alt="lightboxPhoto.caption" />
      <p>{{ lightboxPhoto.kind === 'map_reference' ? '地图参考截图' : '现场照片' }} · {{ lightboxPhoto.caption }}</p>
    </div>
  </main>
</template>
