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
