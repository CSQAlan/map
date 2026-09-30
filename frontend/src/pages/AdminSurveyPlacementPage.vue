<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import SurveyRecordsMap from '../components/SurveyRecordsMap.vue';

const props = defineProps({
  apiBaseUrl: { type: String, required: true },
  accessToken: { type: String, required: true },
});
const emit = defineEmits(['back']);
const sites = ref([]);
const features = ref([]);
const selectedSiteCode = ref('');
const selectedRecordCode = ref(null);
const pendingCoordinate = ref(null);
const saving = ref(false);
const loading = ref(false);
const message = ref('');
const errorMessage = ref('');
const mapFailure = ref('');
const lightboxPhoto = ref(null);

const selectedFeature = computed(() =>
  features.value.find((feature) => feature.properties.record_code === selectedRecordCode.value) ?? null
);
const allLocatedCenter = computed(() => {
  const points = features.value.map((feature) => feature.geometry?.coordinates).filter(Boolean);
  if (!points.length) return [];
  return [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  ];
});
const selectedMedia = computed(() => selectedFeature.value?.properties.evidence_photos ?? []);

onMounted(async () => {
  await loadSites();
  await loadRecords();
});
watch(selectedSiteCode, loadRecords);

async function loadSites() {
  try {
    const response = await fetch(`${props.apiBaseUrl}/api/survey-records/sites`);
    if (!response.ok) throw new Error('地点列表读取失败。');
    sites.value = await response.json();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '地点列表读取失败。';
  }
}

async function loadRecords() {
  loading.value = true;
  errorMessage.value = '';
  const query = new URLSearchParams({ coordinate_system: 'GCJ02' });
  if (selectedSiteCode.value) query.set('site_code', selectedSiteCode.value);
  try {
    const response = await fetch(`${props.apiBaseUrl}/api/survey-records?${query}`);
    if (!response.ok) throw new Error('踩点记录读取失败，请确认数据库已初始化。');
    const payload = await response.json();
    features.value = payload.features ?? [];
    if (!features.value.some((feature) => feature.properties.record_code === selectedRecordCode.value)) {
      selectedRecordCode.value = features.value[0]?.properties.record_code ?? null;
    }
    pendingCoordinate.value = selectedFeature.value?.geometry?.coordinates ?? null;
  } catch (error) {
    features.value = [];
    errorMessage.value = error instanceof Error ? error.message : '踩点记录读取失败。';
  } finally {
    loading.value = false;
  }
}

function selectRecord(recordCode) {
  selectedRecordCode.value = recordCode;
  pendingCoordinate.value = selectedFeature.value?.geometry?.coordinates ?? null;
  message.value = '';
  errorMessage.value = '';
}

async function saveLocation() {
  if (!selectedFeature.value || !pendingCoordinate.value || saving.value) return;
  saving.value = true;
  message.value = '';
  errorMessage.value = '';
  try {
    const response = await fetch(
      `${props.apiBaseUrl}/api/survey-records/${encodeURIComponent(selectedFeature.value.properties.record_code)}/location`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${props.accessToken}`,
        },
        body: JSON.stringify({
          longitude: pendingCoordinate.value[0],
          latitude: pendingCoordinate.value[1],
          coordinate_system: 'GCJ02',
        }),
      }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || '位置保存失败，请重新登录后再试。');
    message.value = '位置已保存；记录仍处于待核查状态，不会用于路线推荐。';
    await loadRecords();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '位置保存失败。';
  } finally {
    saving.value = false;
  }
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
