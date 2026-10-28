<script setup>
import { computed } from 'vue';
import DestinationForm from '../components/elder/DestinationForm.vue';
import MobilityPreferencePicker from '../components/elder/MobilityPreferencePicker.vue';
import AppIcon from '../components/ui/AppIcon.vue';
const props = defineProps({ startName: String, endName: String, startOptions: Array, endOptions: Array, profileOptions: Array, mobilityType: String, actionStatus: String, errorMessage: String, sosSubmitting: Boolean, loading: Boolean, isGuest: Boolean });
const emit = defineEmits(['update:startName', 'update:endName', 'update:mobilityType', 'plan-route', 'open-route-options', 'reroute', 'send-sos', 'open-profile', 'open-assistant']);
const currentProfile = computed(() => props.profileOptions?.find(option => option.value === props.mobilityType)?.label || '选择出行方式');
const shortcuts = computed(() => (props.endOptions || []).filter(option => option.value !== props.startName).slice(0, 3));
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
      </section>
    </div>
    <button class="home-assistant-entry" type="button" @click="emit('open-assistant')"><span class="assistant-entry-icon"><AppIcon name="chat" :size="26" /></span><span><strong>出行有疑问，问问小助手</strong><small>路线怎么看？轮椅出行要留意什么？</small></span><AppIcon name="arrow" :size="22" /></button>
    <div class="home-tools"><button type="button" @click="emit('open-route-options')"><AppIcon name="route" /><span>我的路线</span><AppIcon name="chevron" :size="18" /></button><button class="home-sos" type="button" :disabled="sosSubmitting" @click="emit('send-sos')"><AppIcon name="help" /><span>{{ sosSubmitting ? '正在记录…' : '紧急求助' }}</span><AppIcon name="chevron" :size="18" /></button></div>
    <p class="home-status" role="status"><AppIcon name="shield" :size="16" />{{ actionStatus }}</p>
  </section>
</template>
