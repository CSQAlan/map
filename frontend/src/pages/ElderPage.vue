<script setup>
import { computed, ref, watch } from 'vue';
import { NEARBY_ROUTE_BUDGETS, nearbyRouteBudget } from '../composables/useNearbyServices.js';
import DestinationForm from '../components/elder/DestinationForm.vue';
import MobilityPreferencePicker from '../components/elder/MobilityPreferencePicker.vue';
import AppIcon from '../components/ui/AppIcon.vue';
const props = defineProps({ startName: String, endName: String, startOptions: Array, endOptions: Array, profileOptions: Array, mobilityType: String, actionStatus: String, errorMessage: String, sosSubmitting: Boolean, loading: Boolean, isGuest: Boolean, nearbyResults: { type: Array, default: () => [] }, nearbyStatus: String, nearbyMessage: String });
const emit = defineEmits(['update:startName', 'update:endName', 'update:mobilityType', 'plan-route', 'open-route-options', 'reroute', 'send-sos', 'open-profile', 'open-assistant', 'check-nearby', 'choose-nearby']);
const currentProfile = computed(() => props.profileOptions?.find(option => option.value === props.mobilityType)?.label || '选择出行方式');
const shortcuts = computed(() => (props.endOptions || []).filter(option => option.value !== props.startName).slice(0, 3));
const formatNearbyDistance = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const nearbyDistance = value => formatNearbyDistance.format(value);
const nearbyBudget = ref('');
const nearbyCards = computed(() => props.nearbyResults.map(item => ({ ...item, budgetState: nearbyRouteBudget(item, nearbyBudget.value) })));
watch([() => props.startName, () => props.mobilityType], () => { nearbyBudget.value = ''; }, { flush: 'sync' });
function submitPlan() { if (props.startName?.trim() && props.endName?.trim()) emit('plan-route'); }
</script>

<template>
  <section class="home-v2">
    <header class="home-greeting"><div><p>每一次出门，都值得安心</p><h1>今天，想去哪儿走走？</h1></div><button v-if="!isGuest" class="home-avatar" aria-label="打开我的资料" @click="emit('open-profile')"><AppIcon name="user" /></button></header>
    <div class="home-journey-grid">
      <section class="walk-banner" aria-label="适老出行介绍">
        <div class="walk-banner-copy"><span class="walk-tag"><AppIcon name="leaf" :size="15" />让出行更从容</span><h2>熟悉的路，<br />多一份照顾。</h2><p>根据您的出行情况<br />寻找更合适的步行路线</p><span class="illustration-caption">社区步道示意</span></div>
        <svg class="walk-illustration" viewBox="0 0 240 230" fill="none" aria-hidden="true">
          <ellipse cx="143" cy="184" rx="100" ry="28" fill="#D5E7DE" />
          <path d="M83 218c-63-50-21-63 44-79 77-19 64-45 25-65" stroke="#FBFEFC" stroke-width="36" />
          <path d="M83 218c-63-50-21-63 44-79 77-19 64-45 25-65" stroke="#9DBFB1" stroke-width="2" stroke-dasharray="5 7" />
          <path d="M53 159v-35m0 14-13-10m13 0 13-10M191 135V96m0 16-14-10m14 0 13-10" stroke="#487965" stroke-width="4" stroke-linecap="round" />
          <ellipse cx="52" cy="106" rx="24" ry="32" fill="#91B69B" /><ellipse cx="188" cy="79" rx="28" ry="36" fill="#A4C4A6" />
          <path d="M156 57c0 12-16 25-16 25s-16-13-16-25a16 16 0 1 1 32 0Z" fill="#24685B" /><circle cx="140" cy="57" r="5" fill="white" />
          <path d="M164 174h31m-27-8h24m-23 9v9m21-9v9" stroke="#B28753" stroke-width="5" stroke-linecap="round" />
          <circle cx="102" cy="127" r="8" fill="#E3B490" /><path d="m98 138-5 23 12 5 6-25" fill="#D09A46" /><path d="m97 164-7 21m14-18 9 18m-5-40 10 10" stroke="#324D45" stroke-width="5" stroke-linecap="round" /><path d="m120 153 5 35" stroke="#7A7368" stroke-width="3" stroke-linecap="round" />
          <circle cx="42" cy="182" r="4" fill="#D5B774" /><circle cx="216" cy="156" r="3" fill="#D5B774" />
        </svg>
      </section>
      <section class="home-plan-panel" aria-labelledby="trip-title">
        <div class="home-section-heading"><h2 id="trip-title">安排一次出行</h2><AppIcon name="route" /></div>
        <DestinationForm :start-name="startName" :end-name="endName" :start-options="startOptions" :end-options="endOptions" :loading="loading" :error="errorMessage" @update:start-name="emit('update:startName', $event)" @update:end-name="emit('update:endName', $event)" @submit="submitPlan" />
        <div v-if="shortcuts.length" class="destination-shortcuts"><span>想去</span><button v-for="option in shortcuts" :key="option.value" type="button" @click="emit('update:endName', option.value)">{{ option.label }}</button></div>
        <details class="home-preferences"><summary><span><AppIcon name="shield" :size="19" />{{ currentProfile }}</span><span class="preference-change">更改 <AppIcon name="chevron" :size="15" /></span></summary><MobilityPreferencePicker :model-value="mobilityType" :options="profileOptions" label="选择适合您的出行情况" @update:model-value="emit('update:mobilityType', $event)" /></details>
        <section class="nearby-services" aria-label="试点服务可达性">
          <h3>试点服务可达性</h3>
          <p>从手动选择的出发地点，按当前出行方式核对最多 3 个试点服务方向。距离按已登记路线计算，不保证现场通行。</p>
          <label class="nearby-budget-choice">可选总路线距离预算
            <select v-model="nearbyBudget" aria-label="附近服务总路线预算">
              <option value="">不设预算（保留全部结果）</option>
              <option v-for="budget in NEARBY_ROUTE_BUDGETS" :key="budget" :value="budget">{{ budget }} 米</option>
            </select>
          </label>
          <p>这里比较全程路线距离，不是最长连续步行段。按现有综合推荐计算，不代表全局最短；超过预算也不表示不存在其他预算内路线。</p>
          <button class="secondary-action" type="button" :disabled="nearbyStatus === 'loading'" @click="emit('check-nearby')">
            {{ nearbyStatus === 'loading' ? '正在核对试点服务…' : '查看附近服务可达性' }}
          </button>
          <p v-if="nearbyMessage" role="status">{{ nearbyMessage }}</p>
          <ul v-if="nearbyResults.length" aria-live="polite">
            <li v-for="item in nearbyCards" :key="item.name">
              <strong>{{ item.name }}</strong>
              <p v-if="item.boundaryText">{{ item.boundaryText }}</p>
              <span>{{ item.type === 'REST_AREA' ? '休息区' : '生活服务方向（人行道）' }}</span>
              <span v-if="['unset', 'within', 'over'].includes(item.budgetState)">已找到符合当前条件的登记路线 · {{ nearbyDistance(item.distance) }} 米</span>
              <span v-else-if="item.state === 'unreachable'">现有试点路网未找到符合当前出行条件的路线</span>
              <span v-else>暂时无法确认可达性，不代表没有路线</span>
              <template v-if="nearbyBudget !== ''">
                <strong v-if="item.budgetState === 'within'" class="nearby-budget-result">这条算出的路线在预算内（≤ {{ nearbyBudget }} 米，等于也算）</strong>
                <strong v-else-if="item.budgetState === 'over'" class="nearby-budget-result">这条算出的路线超过预算（{{ nearbyBudget }} 米）</strong>
                <span v-else-if="item.budgetState === 'no-route'">未找到同条件兼容路线，预算不适用；不是超标。</span>
                <span v-else>预算暂未确认，未知或缺少距离不能当作零或超标。</span>
              </template>
              <button v-if="['unset', 'within', 'over'].includes(item.budgetState)" class="secondary-action" type="button" @click="emit('choose-nearby', item.name)">设为目的地</button>
            </li>
          </ul>
        </section>
      </section>
    </div>
    <button class="home-assistant-entry" type="button" @click="emit('open-assistant')"><span class="assistant-entry-icon"><AppIcon name="chat" :size="26" /></span><span><strong>出行有疑问，问问小助手</strong><small>路线怎么看？轮椅出行要留意什么？</small></span><AppIcon name="arrow" :size="22" /></button>
    <div class="home-tools"><button type="button" @click="emit('open-route-options')"><AppIcon name="route" /><span>我的路线</span><AppIcon name="chevron" :size="18" /></button><button class="home-sos" type="button" :disabled="sosSubmitting" @click="emit('send-sos')"><AppIcon name="help" /><span>{{ sosSubmitting ? '正在记录…' : '紧急求助' }}</span><AppIcon name="chevron" :size="18" /></button></div>
    <p class="home-status" role="status"><AppIcon name="shield" :size="16" />{{ actionStatus }}</p>
  </section>
</template>

<style scoped>
.nearby-services { grid-column: 1 / -1; min-width: 0; padding: 16px; border: 1px solid #c3d5cc; border-radius: 12px; background: #f1f7f3; line-height: 1.6; }
.nearby-services h3 { margin: 0; font-size: 1.1rem; }
.nearby-services p { margin: 8px 0; }
.nearby-services ul { display: grid; gap: 8px; list-style: none; padding: 0; margin: 12px 0 0; }
.nearby-services li { display: grid; justify-items: start; gap: 4px; min-width: 0; padding: 10px; border-radius: 8px; background: white; overflow-wrap: anywhere; }
.nearby-services button { min-height: 44px; max-width: 100%; white-space: normal; }
.nearby-budget-choice { display: grid; gap: 8px; margin: 12px 0; font-size: 1.125rem; }
.nearby-budget-choice select { min-height: 48px; width: 100%; max-width: 100%; padding: 8px; font: inherit; }
.nearby-budget-result { font-size: 1.125rem; line-height: 1.7; }
</style>
