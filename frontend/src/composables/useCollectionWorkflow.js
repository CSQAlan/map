import { computed, ref } from 'vue';
import { getCurrentCoordinates } from '../services/deviceLocation.js';
import { apiRequest } from '../services/apiClient.js';

const createCollectionForm = () => ({
  segment_code: '',
  collector: '采集员A',
  surface_type: 'CONCRETE',
  surface_level: 4,
  safety_level: 4,
  barrier_free_level: 4,
  rest_facility_score: 3,
  lighting_level: 4,
  crossing_safety_level: 4,
  width_m: 1.5,
  wheelchair_accessible: true,
  has_handrail: false,
  has_ramp: true,
  shade_coverage_percent: 30,
  bench_count: 0,
  step_count: 0,
  step_height_cm: 0,
  location_lat: null,
  location_lon: null,
  photo_urls: [],
  remark: '',
});

function formatApiError(detail, fallback = '采集记录提交失败。') {
  if (Array.isArray(detail)) {
    return detail.map((item) => item.msg ?? JSON.stringify(item)).join('；');
  }
  if (typeof detail === 'string') return detail;
  return fallback;
}

export function useCollectionWorkflow({
  apiBaseUrl,
  adminAccessToken = () => '',
  auditAccessToken = () => '',
  loadMapData = async () => {},
}) {
  const collectionSegments = ref([]);
  const pendingCollectionRecords = ref([]);
  const collectionLoading = ref(false);
  const collectionSubmitting = ref(false);
  const auditLoadingIds = ref(new Set());
  const collectionMessage = ref('手机端采集表已准备好，选择路段后即可提交待审核数据。');
  const collectionError = ref('');
  const collectionForm = ref(createCollectionForm());

  const selectedCollectionSegment = computed(() =>
    collectionSegments.value.find((segment) => segment.segment_code === collectionForm.value.segment_code)
  );

  async function loadSegments() {
    collectionLoading.value = true;
    try {
      const response = await fetch(`${apiBaseUrl}/api/collect/segments`);
      if (!response.ok) {
        throw new Error('路段列表接口暂时不可用。');
      }
      const payload = await response.json();
      collectionSegments.value = Array.isArray(payload) ? payload : [];
      if (!collectionForm.value.segment_code && collectionSegments.value.length) {
        selectSegment(collectionSegments.value[0].segment_code);
      }
    } catch {
      collectionError.value = '无法加载可采集路段，请确认后端服务已启动。';
    } finally {
      collectionLoading.value = false;
    }
  }

  async function loadPendingReviewList() {
    try {
      pendingCollectionRecords.value = await apiRequest('/api/collect/pending', {
        token: adminAccessToken(),
      });
    } catch {
      pendingCollectionRecords.value = [];
      collectionError.value = '待审核列表暂时无法加载，但不影响提交采集记录。';
    }
  }

  function selectSegment(segmentCode) {
    collectionForm.value.segment_code = segmentCode;
    const segment = collectionSegments.value.find((item) => item.segment_code === segmentCode);
    if (!segment) return;
    collectionForm.value.width_m = Number(segment.width_m ?? collectionForm.value.width_m);
    collectionForm.value.surface_type = segment.surface_type ?? 'CONCRETE';
  }

  function captureGeolocation() {
    collectionError.value = '';
    collectionMessage.value = '正在读取手机定位，请稍等。';
    getCurrentCoordinates()
      .then(({ latitude, longitude }) => {
        collectionForm.value.location_lat = latitude;
        collectionForm.value.location_lon = longitude;
        collectionMessage.value = '已记录当前位置，会随采集备注一起提交。';
      })
      .catch(() => {
        collectionError.value = '定位失败，请检查定位权限，或先不带定位提交。';
      });
  }

  async function submitCollection() {
    collectionSubmitting.value = true;
    collectionError.value = '';
    collectionMessage.value = '正在提交采集记录...';
    try {
      const response = await fetch(`${apiBaseUrl}/api/collect/segments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collectionForm.value),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(formatApiError(payload.detail));
      }
      collectionMessage.value = `已提交记录 #${payload.id}，状态：${payload.status}，等待管理员审核。`;
      collectionForm.value.remark = '';
      collectionForm.value.location_lat = null;
      collectionForm.value.location_lon = null;
    } catch (error) {
      collectionError.value = error instanceof Error ? error.message : '采集记录提交失败。';
      collectionMessage.value = '提交没有成功，请检查字段后再试一次。';
    } finally {
      collectionSubmitting.value = false;
    }
  }

  async function auditCollection(record, auditResult) {
    const nextLoadingIds = new Set(auditLoadingIds.value);
    nextLoadingIds.add(record.id);
    auditLoadingIds.value = nextLoadingIds;
    collectionError.value = '';
    collectionMessage.value = auditResult === 'APPROVED' ? '正在通过采集记录...' : '正在驳回采集记录...';
    try {
      const response = await fetch(`${apiBaseUrl}/api/collect/segments/${record.id}/audit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auditAccessToken()}`,
        },
        body: JSON.stringify({
          audit_result: auditResult,
          auditor: '系统管理员',
          audit_comment: auditResult === 'APPROVED' ? '现场采集数据通过审核' : '演示驳回，需重新采集',
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(formatApiError(payload.detail));
      }
      collectionMessage.value = payload.message ?? '审核操作已完成。';
      await Promise.all([loadPendingReviewList(), loadMapData()]);
    } catch (error) {
      collectionError.value = error instanceof Error ? error.message : '审核操作失败。';
      collectionMessage.value = '审核没有成功，请稍后再试。';
    } finally {
      const updatedLoadingIds = new Set(auditLoadingIds.value);
      updatedLoadingIds.delete(record.id);
      auditLoadingIds.value = updatedLoadingIds;
    }
  }

  return {
    collectionSegments,
    pendingCollectionRecords,
    collectionLoading,
    collectionSubmitting,
    auditLoadingIds,
    collectionMessage,
    collectionError,
    collectionForm,
    selectedCollectionSegment,
    loadSegments,
    loadPendingReviewList,
    selectSegment,
    captureGeolocation,
    submitCollection,
    auditCollection,
  };
}
