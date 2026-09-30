<script setup>
import DestinationForm from '../components/elder/DestinationForm.vue';
import MobilityPreferencePicker from '../components/elder/MobilityPreferencePicker.vue';

const props = defineProps({ startName: String, endName: String, startOptions: Array, endOptions: Array, profileOptions: Array, mobilityType: String, actionStatus: String, errorMessage: String, sosSubmitting: Boolean, loading: Boolean, isGuest: Boolean });
const emit = defineEmits(['update:startName', 'update:endName', 'update:mobilityType', 'plan-route', 'open-route-options', 'reroute', 'send-sos', 'open-profile']);
function submitPlan() { if (props.startName?.trim() && props.endName?.trim()) emit('plan-route'); }
</script>

<template>
  <section class="elder-home" aria-live="polite">
    <header class="elder-home-header"><div><p class="section-kicker">助老出行</p><h1>您要去哪里？</h1></div><button v-if="!isGuest" class="profile-shortcut" type="button" @click="$emit('open-profile')">我的</button></header>
    <div class="elder-trip-form">
      <DestinationForm
        :start-name="startName"
        :end-name="endName"
        :start-options="startOptions"
        :end-options="endOptions"
        :loading="loading"
        :error="errorMessage"
        @update:start-name="$emit('update:startName', $event)"
        @update:end-name="$emit('update:endName', $event)"
        @submit="submitPlan"
      />
      <MobilityPreferencePicker
        :model-value="mobilityType"
        :options="profileOptions"
        label="按您的出行情况推荐"
        @update:model-value="$emit('update:mobilityType', $event)"
      />
    </div>
    <div class="elder-quick-actions"><button type="button" @click="$emit('open-route-options')"><i>⌁</i>路线方案</button><button type="button" @click="$emit('reroute')"><i>↻</i>修改条件</button><button class="emergency-action" type="button" :disabled="sosSubmitting" @click="$emit('send-sos')"><i>!</i>{{ sosSubmitting ? '发送中' : '紧急求助' }}</button></div>
    <p class="elder-status">{{ actionStatus }}</p>
  </section>
</template>
