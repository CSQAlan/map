<script setup>
const props = defineProps({
  collectionSegments: Array,
  collectionForm: Object,
  selectedCollectionSegment: Object,
  collectionLoading: Boolean,
  collectionSubmitting: Boolean,
  collectionMessage: String,
  collectionError: String,
  pendingCollectionRecords: Array,
  auditLoadingIds: Set
});

const emit = defineEmits([
  'update:segment-code',
  'use-segment',
  'capture-location',
  'submit-collection',
  'audit-collection'
]);

function formatApiError(detail, fallback = '采集记录提交失败。') {
  if (Array.isArray(detail)) {
    return detail.map((item) => item.msg ?? JSON.stringify(item)).join('；');
  }
  if (typeof detail === 'string') return detail;
  return fallback;
}
</script>

<template>
  <section class="collection-panel">
    <div class="collection-hero">
      <div>
        <p class="section-kicker">手机现场采集</p>
        <h2>路段适老数据录入</h2>
        <p>队友到现场后选择路段，记录坡度感受、路宽、台阶、坡道、扶手、照明和备注。提交后进入待审核队列，不会直接覆盖正式路线数据。</p>
      </div>
      <button class="secondary-action" type="button" @click="$emit('capture-location')">
        记录手机定位
      </button>
    </div>

    <form class="collection-form" @submit.prevent="$emit('submit-collection')">
      <label class="field-block full-span">
        <span>选择采集路段</span>
        <select
          :value="collectionForm.segment_code"
          :disabled="collectionLoading"
          @change="$emit('update:segment-code', $event.target.value); $emit('use-segment', $event.target.value)"
        >
          <option
            v-for="segment in collectionSegments"
            :key="segment.segment_code"
            :value="segment.segment_code"
          >
            {{ segment.name || segment.segment_code }}
          </option>
        </select>
      </label>

      <div v-if="selectedCollectionSegment" class="selected-segment-card full-span">
        <strong>{{ selectedCollectionSegment.name }}</strong>
        <span>{{ selectedCollectionSegment.segment_code }} · {{ selectedCollectionSegment.length_m }} 米 · 坡度 {{ selectedCollectionSegment.slope_percent }}%</span>
      </div>

      <label class="field-block">
        <span>采集人</span>
        <input :value="collectionForm.collector" @input="$emit('update:collector', $event.target.value)" maxlength="50" required />
      </label>

      <label class="field-block">
        <span>路面类型</span>
        <select :value="collectionForm.surface_type" @change="$emit('update:surface_type', $event.target.value)">
          <option value="CONCRETE">水泥 / 混凝土</option>
          <option value="ASPHALT">沥青</option>
          <option value="BRICK">砖石</option>
          <option value="TILE">地砖</option>
          <option value="GRAVEL">碎石</option>
          <option value="COBBLESTONE">鹅卵石</option>
        </select>
      </label>

      <label class="field-block">
        <span>路宽（米）</span>
        <input :value="collectionForm.width_m" @input="$emit('update:width_m', $event.target.value)" min="0" max="20" step="0.1" type="number" required />
      </label>

      <label class="field-block">
        <span>路面平整度 1-5</span>
        <input :value="collectionForm.surface_level" @input="$emit('update:surface_level', $event.target.value)" min="1" max="5" type="number" required />
      </label>

      <label class="field-block">
        <span>安全等级 1-5</span>
        <input :value="collectionForm.safety_level" @input="$emit('update:safety_level', $event.target.value)" min="1" max="5" type="number" required />
      </label>

      <label class="field-block">
        <span>无障碍等级 1-5</span>
        <input :value="collectionForm.barrier_free_level" @input="$emit('update:barrier_free_level', $event.target.value)" min="1" max="5" type="number" required />
      </label>

      <label class="field-block">
        <span>休息设施评分 1-5</span>
        <input :value="collectionForm.rest_facility_score" @input="$emit('update:rest_facility_score', $event.target.value)" min="1" max="5" type="number" required />
      </label>

      <label class="field-block">
        <span>照明等级 1-5</span>
        <input :value="collectionForm.lighting_level" @input="$emit('update:lighting_level', $event.target.value)" min="1" max="5" type="number" required />
      </label>

      <label class="field-block">
        <span>过街安全 1-5</span>
        <input :value="collectionForm.crossing_safety_level" @input="$emit('update:crossing_safety_level', $event.target.value)" min="1" max="5" type="number" required />
      </label>

      <label class="field-block">
        <span>树荫覆盖率 %</span>
        <input :value="collectionForm.shade_coverage_percent" @input="$emit('update:shade_coverage_percent', $event.target.value)" min="0" max="100" type="number" required />
      </label>

      <label class="field-block">
        <span>座椅数量</span>
        <input :value="collectionForm.bench_count" @input="$emit('update:bench_count', $event.target.value)" min="0" type="number" required />
      </label>

      <label class="field-block">
        <span>台阶数量</span>
        <input :value="collectionForm.step_count" @input="$emit('update:step_count', $event.target.value)" min="0" type="number" required />
      </label>

      <label class="field-block">
        <span>台阶高度（厘米）</span>
        <input :value="collectionForm.step_height_cm" @input="$emit('update:step_height_cm', $event.target.value)" min="0" max="100" step="0.5" type="number" required />
      </label>

      <div class="toggle-grid full-span">
        <label>
          <input :checked="collectionForm.wheelchair_accessible" @change="$emit('update:wheelchair_accessible', $event.target.checked)" type="checkbox" />
          轮椅可通行
        </label>
        <label>
          <input :checked="collectionForm.has_ramp" @change="$emit('update:has_ramp', $event.target.checked)" type="checkbox" />
          有坡道
        </label>
        <label>
          <input :checked="collectionForm.has_handrail" @change="$emit('update:has_handrail', $event.target.checked)" type="checkbox" />
          有扶手
        </label>
      </div>

      <label class="field-block full-span">
        <span>现场备注</span>
        <textarea
          :value="collectionForm.remark"
          @input="$emit('update:remark', $event.target.value)"
          maxlength="400"
          placeholder="例如：路面平整但下午人流较多；入口有 1 级小台阶。"
        ></textarea>
      </label>

      <div class="location-preview full-span">
        <span>定位</span>
        <strong v-if="collectionForm.location_lat !== null && collectionForm.location_lon !== null">
          {{ collectionForm.location_lon }}, {{ collectionForm.location_lat }}
        </strong>
        <strong v-else>暂未记录，可直接提交</strong>
      </div>

      <button class="primary-action full-span" type="submit" :disabled="collectionSubmitting || !collectionForm.segment_code">
        {{ collectionSubmitting ? '正在提交...' : '提交为待审核记录' }}
      </button>
    </form>

    <p class="status-line">{{ collectionMessage }}</p>
    <p v-if="collectionError" class="error-line">{{ collectionError }}</p>

    <section class="pending-panel">
      <div class="panel-heading">
        <p class="section-kicker">待审核数据</p>
        <h2>最近 {{ pendingCollectionRecords.length }} 条采集记录</h2>
      </div>
      <article
        v-for="record in pendingCollectionRecords"
        :key="record.id"
        class="pending-card"
      >
        <strong>{{ record.segment_name || record.segment_code }}</strong>
        <span>{{ record.collector_name }} · 平整 {{ record.surface_level }} · 安全 {{ record.safety_level }} · 无障碍 {{ record.barrier_free_level }}</span>
        <span>路宽 {{ record.width_m }} 米 · 坡道 {{ record.has_ramp ? '有' : '无' }} · 扶手 {{ record.has_handrail ? '有' : '无' }} · 台阶 {{ record.step_count }}</span>
        <p>{{ record.remark || '暂无备注' }}</p>
        <div class="pending-actions">
          <button
            class="audit-action approve"
            type="button"
            :disabled="auditLoadingIds.has(record.id)"
            @click="$emit('audit-collection', record, 'APPROVED')"
          >
            通过并更新路段
          </button>
          <button
            class="audit-action reject"
            type="button"
            :disabled="auditLoadingIds.has(record.id)"
            @click="$emit('audit-collection', record, 'REJECTED')"
          >
            驳回
          </button>
        </div>
      </article>
    </section>
  </section>
</template>

<style scoped>
.collection-panel {
  --collect-ink: #203747;
  --collect-blue: #286887;
  --collect-line: #d8e3e9;
  width: min(100%, 1120px);
  min-width: 0;
  margin-inline: auto;
  padding: clamp(18px, 3vw, 34px);
  border: 1px solid var(--collect-line);
  border-radius: 16px;
  color: var(--collect-ink);
  background: #fff;
  box-shadow: 0 3px 14px rgb(32 55 71 / 6%);
}

.collection-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 20px 32px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--collect-line);
}

.collection-hero h2 {
  margin: 5px 0 8px;
  color: var(--collect-ink);
  font-size: clamp(24px, 3vw, 32px);
  letter-spacing: -0.025em;
}

.collection-hero > div > p:last-child {
  max-width: 72ch;
  margin: 0;
  color: #526b79;
  line-height: 1.7;
}

.collection-panel button:focus-visible,
.collection-panel input:focus-visible,
.collection-panel select:focus-visible,
.collection-panel textarea:focus-visible {
  outline: 3px solid #73b6d1;
  outline-offset: 2px;
}

.collection-panel .secondary-action,
.collection-panel .primary-action,
.pending-actions .audit-action {
  min-height: 50px;
  border-radius: 9px;
  padding: 11px 18px;
  font-weight: 750;
  cursor: pointer;
}

.collection-panel .secondary-action {
  border: 1px solid #a9c2ce;
  color: var(--collect-blue);
  background: #f5f9fa;
  white-space: nowrap;
}

.collection-form {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px 22px;
  margin-top: 24px;
}

.collection-form .full-span { grid-column: 1 / -1; }

.collection-panel .field-block { min-width: 0; gap: 8px; }

.collection-panel .field-block > span {
  color: #304f60;
  font-size: 15px;
  font-weight: 700;
}

.collection-panel .field-block input,
.collection-panel .field-block select,
.collection-panel .field-block textarea {
  width: 100%;
  min-width: 0;
  min-height: 50px;
  border: 1px solid #b9cbd5;
  border-radius: 9px;
  padding: 11px 13px;
  color: var(--collect-ink);
  background: #fff;
  font: inherit;
}

.collection-panel .field-block textarea {
  min-height: 112px;
  resize: vertical;
  line-height: 1.55;
}

.collection-panel .field-block input:disabled,
.collection-panel .field-block select:disabled { background: #f1f5f7; }

.selected-segment-card,
.location-preview {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 18px;
  min-width: 0;
  padding: 15px 17px;
  border: 1px solid #c9dce5;
  border-radius: 10px;
  background: #f2f7f9;
}

.selected-segment-card strong,
.location-preview strong { overflow-wrap: anywhere; }
.selected-segment-card span { color: #526b79; }
.location-preview > span { color: #526b79; font-weight: 700; }

.collection-panel .toggle-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.collection-panel .toggle-grid label {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 10px 13px;
  border: 1px solid var(--collect-line);
  border-radius: 9px;
  color: #304f60;
  background: #f8fafb;
  cursor: pointer;
}

.collection-panel .toggle-grid input {
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  accent-color: var(--collect-blue);
}

.collection-panel .primary-action {
  border: 1px solid var(--collect-blue);
  color: #fff;
  background: var(--collect-blue);
}

.collection-panel .primary-action:hover:not(:disabled) { background: #205873; }
.collection-panel button:disabled { cursor: not-allowed; opacity: 0.58; }

.collection-panel .status-line,
.collection-panel .error-line {
  overflow-wrap: anywhere;
  line-height: 1.55;
}

.pending-panel {
  margin-top: 30px;
  padding-top: 24px;
  border-top: 1px solid var(--collect-line);
}

.pending-panel .panel-heading { margin-bottom: 16px; }
.pending-panel .panel-heading h2 { margin: 4px 0 0; color: var(--collect-ink); }

.pending-card {
  min-width: 0;
  padding: 18px;
  border: 1px solid var(--collect-line);
  border-left: 4px solid #c98b24;
  border-radius: 10px;
  background: #fbfcfd;
}

.pending-card + .pending-card { margin-top: 12px; }
.pending-card strong { overflow-wrap: anywhere; color: var(--collect-ink); }
.pending-card span { overflow-wrap: anywhere; line-height: 1.6; }
.pending-card p { line-height: 1.6; }

.pending-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
}

.pending-actions .audit-action { min-width: 112px; }
.pending-actions .approve { color: #fff; background: var(--collect-blue); }
.pending-actions .reject { border: 1px solid #b96f62; color: #8b4237; background: #fff; }

@media (max-width: 700px) {
  .collection-panel { padding: 20px 16px; border-radius: 12px; }
  .collection-hero { grid-template-columns: minmax(0, 1fr); gap: 16px; }
  .collection-panel .secondary-action { width: 100%; }
  .collection-form { grid-template-columns: minmax(0, 1fr); gap: 15px; }
  .collection-form .full-span { grid-column: auto; }
  .collection-panel .toggle-grid { grid-template-columns: minmax(0, 1fr); }
  .collection-panel .toggle-grid label { min-height: 52px; }
  .collection-panel .primary-action.full-span { grid-column: auto; width: 100%; }
  .pending-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pending-actions .audit-action { min-width: 0; padding-inline: 10px; }
}

@media (max-width: 380px) {
  .collection-panel { padding: 18px 12px; }
  .pending-actions { grid-template-columns: minmax(0, 1fr); }
  .pending-actions .audit-action { width: 100%; }
}
</style>
