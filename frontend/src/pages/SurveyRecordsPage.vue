<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import SurveyRecordsMap from '../components/SurveyRecordsMap.vue';
import SurveyPhoto from '../components/SurveyPhoto.vue';
import SurveyPhotoViewer from '../components/SurveyPhotoViewer.vue';
import { useSurveyRecords } from '../composables/useSurveyRecords.js';
import '../styles/survey-browser.css';

const props = defineProps({ apiBaseUrl: { type: String, required: true } });
const {
  sites, features, selectedSiteCode, selectedRecordCode, loading, sitesLoading, errorMessage, siteError,
  selectedFeature, selectedPhotos, unlocatedFeatures, allLocatedCenter, reload, dispose, selectRecord,
} = useSurveyRecords({ apiBaseUrl: props.apiBaseUrl });
const mapOpen = ref(window.matchMedia('(min-width: 1024px)').matches);
const mapFailure = ref('');
const photoIndex = ref(-1);
const detail = ref(null);
const busy = computed(() => loading.value || sitesLoading.value);
const errors = computed(() => [...new Set([errorMessage.value, siteError.value].filter(Boolean))]);
watch([selectedRecordCode, selectedSiteCode], () => { photoIndex.value = -1; });
function viewRecord(code) {
  selectRecord(code);
  if (window.matchMedia('(max-width: 767px)').matches) {
    // Bring the chosen photos into view without moving keyboard focus.
    detail.value?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }
}
onMounted(reload);
onBeforeUnmount(dispose);
</script>

<template>
  <section class="survey-library" aria-labelledby="survey-title">
    <header class="survey-library-header">
      <div><h1 id="survey-title">踩点资料</h1><p>看看大家拍下的道路、台阶和周边环境。</p></div>
      <label class="survey-library-filter">
        <span>选择地点</span>
        <select v-model="selectedSiteCode" aria-label="按踩点地点筛选" :disabled="sitesLoading">
          <option value="">{{ sites.length ? `全部 ${sites.length} 个地点` : '全部地点' }}</option>
          <option v-for="site in sites" :key="site.site_code" :value="site.site_code">{{ site.name }}（{{ site.record_count }}）</option>
        </select>
      </label>
    </header>
    <div class="survey-library-notice" role="note"><strong>资料待核查</strong><span>照片和位置仅供了解环境，请勿据此判断通行安全。资料暂不用于路线推荐。</span></div>
    <div v-if="errors.length" class="survey-library-error" role="alert">
      <div><strong>资料还没有加载成功</strong><p v-for="error in errors" :key="error">{{ error }}</p></div>
      <button type="button" class="secondary-action" :disabled="busy" @click="reload">重新加载资料</button>
    </div>
    <p v-if="busy" class="survey-library-loading" role="status">正在读取踩点资料…</p>
    <div v-else-if="!features.length && !errorMessage" class="survey-library-empty" role="status">
      <h2>{{ selectedSiteCode ? '这个地点还没有踩点资料' : '暂无踩点资料' }}</h2>
      <p>可以换个地点看看，或稍后重新加载。</p>
      <button v-if="selectedSiteCode" type="button" class="secondary-action" @click="selectedSiteCode = ''">查看全部地点</button>
      <button v-else type="button" class="secondary-action" @click="reload">重新加载资料</button>
    </div>
    <div v-if="features.length" class="survey-library-workspace">
      <section class="survey-library-records" aria-label="全部踩点记录">
        <header><h2>选择一条记录</h2><span>{{ features.length }} 条</span></header>
        <select class="survey-library-record-select" aria-label="选择踩点记录" :value="selectedRecordCode" @change="viewRecord($event.target.value)">
          <option v-for="feature in features" :key="feature.properties.record_code" :value="feature.properties.record_code">{{ feature.properties.title }} · {{ feature.properties.site_name }}</option>
        </select>
        <div class="survey-library-record-list">
          <button v-for="feature in features" :key="feature.properties.record_code" type="button" class="survey-library-record"
            :aria-pressed="selectedRecordCode === feature.properties.record_code" aria-controls="survey-record-detail"
            @click="viewRecord(feature.properties.record_code)">
            <strong>{{ feature.properties.title }}</strong>
            <span>{{ feature.properties.site_name }}</span>
            <small>{{ feature.geometry ? '已有位置 · 待核查' : '待补位置' }} · {{ feature.properties.evidence_photos?.length || 0 }} 张照片</small>
          </button>
        </div>
        <p class="survey-library-record-note">{{ unlocatedFeatures.length }} 条待补位置，全部照片均可查看。</p>
      </section>
      <div class="survey-library-content">
        <section v-if="selectedFeature" id="survey-record-detail" ref="detail" class="survey-library-detail" aria-labelledby="survey-detail-title">
          <div class="survey-library-detail-heading"><div><p>{{ selectedFeature.properties.site_name }}</p><h2 id="survey-detail-title">{{ selectedFeature.properties.title }}</h2></div><span class="survey-pending-badge">待核查</span></div>
          <p class="survey-library-location">{{ selectedFeature.geometry ? (selectedFeature.properties.location_source === 'EXIF' ? '位置来自照片 GPS，尚未核查。' : '位置由管理员标注，尚未核查。') : '照片尚未补充位置，可先查看现场环境。' }}</p>
          <div v-if="selectedFeature.properties.issue_tags?.length" class="survey-tags"><span v-for="tag in selectedFeature.properties.issue_tags" :key="tag">{{ tag }}</span></div>
          <div v-if="selectedPhotos.length" class="survey-library-photos">
            <SurveyPhoto v-for="(photo, index) in selectedPhotos" :key="photo.photo_id" :photo="photo" :api-base-url="apiBaseUrl" @open="photoIndex = index" />
          </div>
          <p v-else class="survey-library-location">这条记录暂无照片。</p>
          <p v-if="selectedFeature.properties.notes?.length" class="survey-record-note">{{ selectedFeature.properties.notes.join('；') }}</p>
        </section>
        <details :open="mapOpen" class="survey-library-map" @toggle="mapOpen = $event.target.open">
          <summary>在地图上查看位置<span>{{ mapOpen ? '收起' : '展开' }}</span></summary>
          <p v-if="mapFailure" class="survey-library-map-hint">地图暂不可用，您仍可从列表查看全部资料。</p>
          <SurveyRecordsMap v-if="mapOpen" :features="features" :center="allLocatedCenter" :selected-record-code="selectedRecordCode" @select-record="selectRecord" @map-error="mapFailure = $event" />
        </details>
      </div>
    </div>
    <SurveyPhotoViewer :photos="selectedPhotos" :initial-index="photoIndex" :api-base-url="apiBaseUrl" @close="photoIndex = -1" />
  </section>
</template>
