<script setup>
import AppButton from './ui/AppButton.vue';

defineProps({
  records: { type: Array, default: () => [] },
  loadingIds: { type: Set, default: () => new Set() },
});
const emit = defineEmits(['audit']);
</script>

<template>
  <section class="collection-review-table" aria-label="待审核采集记录">
    <div v-if="!records.length" class="collection-review-table__empty" role="status">
      暂无待审核采集记录
    </div>
    <article v-for="record in records" :key="record.id" class="collection-review-table__row">
      <div class="collection-review-table__details">
        <strong>#{{ record.id }} · {{ record.segment_name || record.segment_code }}</strong>
        <span>采集人：{{ record.collector || record.collector_name || '未填写' }}</span>
        <p>{{ record.remark || '无备注' }}</p>
      </div>
      <div class="collection-review-table__actions">
        <AppButton :disabled="loadingIds.has(record.id)" @click="emit('audit', { record, result: 'APPROVED' })">通过</AppButton>
        <AppButton variant="secondary" :disabled="loadingIds.has(record.id)" @click="emit('audit', { record, result: 'REJECTED' })">退回</AppButton>
      </div>
    </article>
  </section>
</template>

<style scoped>
.collection-review-table { display: grid; gap: 0.75rem; min-width: 0; }
.collection-review-table__empty { padding: 1rem; border-radius: 0.75rem; color: #4b606d; background: #f3f6f8; }
.collection-review-table__row { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem; border: 1px solid #d8e1e6; border-radius: 0.875rem; background: #fff; }
.collection-review-table__details { display: grid; min-width: 0; gap: 0.25rem; }
.collection-review-table__details strong { overflow-wrap: anywhere; }
.collection-review-table__details span { color: #586c79; }
.collection-review-table__details p { margin: 0.25rem 0 0; overflow-wrap: anywhere; }
.collection-review-table__actions { display: flex; flex: 0 0 auto; gap: 0.5rem; }
@media (max-width: 767px) {
  .collection-review-table__row { align-items: stretch; flex-direction: column; }
  .collection-review-table__actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
