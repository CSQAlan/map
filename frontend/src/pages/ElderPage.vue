<script setup>
import LocationInput from '../components/LocationInput.vue';

const props = defineProps({ startName: String, endName: String, startOptions: Array, endOptions: Array, actionStatus: String, sosSubmitting: Boolean, loading: Boolean, isGuest: Boolean });
const emit = defineEmits(['update:startName', 'update:endName', 'plan-route', 'reroute', 'send-sos', 'open-profile']);
function submitPlan() { if (props.startName?.trim() && props.endName?.trim()) emit('plan-route'); }
</script>

<template>
  <section class="elder-home" aria-live="polite">
    <header class="elder-home-header"><div><p class="section-kicker">助老出行</p><h1>您要去哪里？</h1></div><button v-if="!isGuest" class="profile-shortcut" type="button" @click="$emit('open-profile')">我的</button></header>
    <form class="elder-trip-form" @submit.prevent="submitPlan">
      <LocationInput :model-value="startName" :options="startOptions" label="起点" icon="起" @update:model-value="$emit('update:startName', $event)" />
      <div class="trip-divider" aria-hidden="true"></div>
      <LocationInput :model-value="endName" :options="endOptions" label="目的地" icon="终" @update:model-value="$emit('update:endName', $event)" />
      <button class="elder-start-button" type="submit" :disabled="loading">{{ loading ? '正在规划…' : '开始导航' }}</button>
    </form>
    <div class="elder-quick-actions"><button type="button" @click="$emit('reroute')"><i>⌁</i>路线详情</button><button type="button" @click="$emit('reroute')"><i>↻</i>重新规划</button><button class="emergency-action" type="button" :disabled="sosSubmitting" @click="$emit('send-sos')"><i>!</i>{{ sosSubmitting ? '发送中' : '紧急求助' }}</button></div>
    <p class="elder-status">{{ actionStatus }}</p>
  </section>
</template>
