<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import SurveyRecordsMap from '../components/SurveyRecordsMap.vue';
import SurveyPhoto from '../components/SurveyPhoto.vue';
import SurveyPhotoViewer from '../components/SurveyPhotoViewer.vue';
import { useSurveyRecords } from '../composables/useSurveyRecords.js';

const props = defineProps({
  apiBaseUrl: { type: String, required: true },
  accessToken: { type: String, required: true },
});
const emit = defineEmits(['back']);
const {
  sites, features, selectedSiteCode, selectedRecordCode, pendingCoordinate, saving, loading,
  message, errorMessage, siteError, selectedFeature, selectedPhotos: selectedMedia,
  allLocatedCenter, reload, dispose, selectRecord, saveLocation,
} = useSurveyRecords({ apiBaseUrl: props.apiBaseUrl, accessToken: () => props.accessToken });
const mapFailure = ref('');
const photoIndex = ref(-1);
watch([selectedRecordCode, selectedSiteCode], () => { photoIndex.value = -1; });

onMounted(reload);
onBeforeUnmount(dispose);
</script>

<template>
  <main class="admin-survey-page">
    <header class="admin-survey-header">
      <div><p class="section-kicker">管理员后台 / 踩点资料</p><h1>对照照片补充位置</h1></div>
      <button type="button" class="secondary-action" @click="emit('back')">返回管理后台</button>
    </header>
    <p class="survey-safety-notice"><strong>只保存位置，不审核资料。</strong><span>位置仍需复核，不会进入路线推荐。</span></p>
    <label class="survey-site-select admin-survey-site"><span>地点筛选</span><select v-model="selectedSiteCode"><option value="">{{ sites.length ? `全部 ${sites.length} 个地点` : '全部地点' }}</option><option v-for="site in sites" :key="site.site_code" :value="site.site_code">{{ site.name }}</option></select></label>
    <p v-if="loading" class="survey-loading" role="status">正在读取记录…</p>
    <p v-if="errorMessage" class="survey-error" role="alert">{{ errorMessage }}</p>
    <p v-if="siteError" class="survey-error" role="alert">{{ siteError }}</p>
    <button v-if="errorMessage || siteError" type="button" class="secondary-action" :disabled="loading || saving" @click="reload">重新加载资料</button>
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
            <SurveyPhoto v-for="(photo, index) in selectedMedia" :key="photo.photo_id" :photo="photo" :api-base-url="apiBaseUrl" @open="photoIndex = index" />
          </div>
          <div class="admin-survey-actions">
            <span v-if="pendingCoordinate" class="survey-coord-readout">已选择地图位置</span>
            <span v-else class="survey-coord-readout">尚未选择位置</span>
            <button type="button" :disabled="!selectedFeature || !pendingCoordinate || saving || loading" @click="saveLocation">{{ saving ? '正在保存…' : '保存位置（仍待核查）' }}</button>
          </div>
        </div>
        <div v-else class="survey-empty-card">当前地点没有记录。</div>
      </div>
    </section>
    <SurveyPhotoViewer :photos="selectedMedia" :initial-index="photoIndex" :api-base-url="apiBaseUrl" @close="photoIndex = -1" />
  </main>
</template>
