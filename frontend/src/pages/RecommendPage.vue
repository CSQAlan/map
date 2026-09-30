<script setup>
import { computed } from 'vue';
import StrategySelector from '../components/StrategySelector.vue';
import LocationInput from '../components/LocationInput.vue';
import MobilityPreferencePicker from '../components/elder/MobilityPreferencePicker.vue';

const props = defineProps({
  mobilityType: String,
  routeStrategy: String,
  startName: String,
  endName: String,
  startOptions: { type: Array, default: () => [] },
  endOptions: { type: Array, default: () => [] },
  profileOptions: { type: Array, default: () => [] },
  strategyOptions: { type: Array, default: () => [] },
  loading: Boolean,
  errorMessage: { type: String, default: '' },
});

const emit = defineEmits([
  'update:mobilityType', 'update:routeStrategy', 'update:startName', 'update:endName', 'plan-routes',
]);
const selectedStrategy = computed(() => props.strategyOptions.find((item) => item.value === props.routeStrategy));
</script>

<template>
  <main class="workspace-grid route-workspace condition-workspace">
    <form class="control-panel" @submit.prevent="emit('plan-routes')">
      <header class="route-page-intro">
        <p class="section-kicker">出行条件</p>
        <h1>调整路线条件</h1>
        <p>修改后重新规划，您的地点和出行情况会保留。</p>
      </header>

      <MobilityPreferencePicker
        :model-value="mobilityType"
        :options="profileOptions"
        label="您的出行情况"
        @update:model-value="emit('update:mobilityType', $event)"
      />

      <StrategySelector
        :model-value="routeStrategy"
        :options="strategyOptions"
        @update:model-value="emit('update:routeStrategy', $event)"
      />
      <p v-if="selectedStrategy" class="strategy-note">{{ selectedStrategy.hint }}</p>

      <LocationInput :model-value="startName" :options="startOptions" label="起点" icon="起" @update:model-value="emit('update:startName', $event)" />
      <LocationInput :model-value="endName" :options="endOptions" label="目的地" icon="终" @update:model-value="emit('update:endName', $event)" />

      <p v-if="errorMessage" class="error-line" role="alert">{{ errorMessage }}</p>
      <div class="condition-actions">
        <button class="primary-action" type="submit" :disabled="loading">
          {{ loading ? '正在重新规划…' : '重新规划路线' }}
        </button>
        <button class="secondary-action" type="button" @click="$router.push('/elder/routes')">返回路线方案</button>
      </div>
    </form>
  </main>
</template>
