<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import AmapRouteMap from '../components/AmapRouteMap.vue';
import FallbackRouteMap from '../components/FallbackRouteMap.vue';
import { createSpeechOutput, buildSegmentInstruction } from '../services/speechOutput.js';
import { watchCoordinates } from '../services/deviceLocation.js';
import { evaluatePosition, remainingDistance, wgs84ToGcj02 } from '../services/navigationJourney.js';
const props = defineProps({ selectedRoute: Object, selectedProfile: Object, mapFeatures: { type: Array, default: () => [] }, pilotArea: Object, mapFailure: String, mapRetrying: Boolean, selectedSegmentCode: String, sosSubmitting: Boolean, progress: { type: Object, default: () => ({ index:0, paused:false }) } });
const emit = defineEmits(['open-routes','end-navigation','retry-map','select-segment','map-error','send-sos','progress']);
const endDialog = ref(null);
const index = ref(props.progress.index || 0); const paused = ref(Boolean(props.progress.paused)); const voiceEnabled = ref(false); const confirmEnd = ref(false);
watch(confirmEnd, async value => { if (value) { await nextTick(); endDialog.value?.querySelector('button')?.focus(); } });
function trapDialog(event) { if (event.key !== 'Tab') return; const buttons=endDialog.value?.querySelectorAll('button'); if (!buttons?.length) return; const first=buttons[0],last=buttons[buttons.length-1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
const { playing, error: voiceError, speak, stop } = createSpeechOutput();
const segments = computed(() => props.selectedRoute?.segments || []);
const segment = computed(() => segments.value[index.value]);
const instruction = computed(() => buildSegmentInstruction(segment.value,index.value,segments.value.length));
const remaining = computed(() => remainingDistance(props.selectedRoute,index.value));
const routeSegmentCodes = computed(() => new Set(props.selectedRoute?.segment_codes || []));
const routePaths = computed(() => props.mapFeatures.filter(f => f.properties?.kind === 'segment' && routeSegmentCodes.value.has(f.properties.segment_code)).map(f => f.geometry.coordinates));
const locationEnabled = ref(false); const position = ref(null); const locationError = ref(''); const quality = ref('waiting'); const offRoute = ref(false);
let clearLocation; let streak = 0; let lastTimestamp = 0; let staleTimer;
const locationMessage = computed(() => locationError.value || (!locationEnabled.value ? '定位未开启，您可以按文字逐段前行。' : quality.value === 'waiting' ? '正在获取位置…' : quality.value === 'stale' ? '位置已过期，请停在安全处等待定位。' : quality.value === 'poor' ? '定位精度较低，暂不判断偏离。' : quality.value === 'no-route' ? '位置已获取，缺少路线图形，暂不判断偏离。' : offRoute.value ? '您可能偏离路线，请先在安全处停下，核对地图。' : `位置已更新，精度约${Math.round(position.value?.accuracy || 0)}米。`));
function confirmFinish() { stop(); stopLocation(); voiceEnabled.value=false; confirmEnd.value=false; emit('end-navigation'); }
function publish() { emit('progress', { index:index.value, paused:paused.value, remaining:remaining.value, instruction:`${paused.value ? '正在休息。' : ''}${instruction.value}` }); }
watch(() => props.selectedRoute, () => { index.value=0; paused.value=false; voiceEnabled.value=false; stop(); confirmEnd.value=false; streak=0; offRoute.value=false; publish(); });
watch([index,paused], () => { publish(); if (voiceEnabled.value && !paused.value) speak(instruction.value); else stop(); });
onMounted(() => emit('select-segment',segment.value?.segment_code));
function advance(delta) { index.value=Math.max(0,Math.min(segments.value.length-1,index.value+delta)); emit('select-segment',segment.value?.segment_code); }
function toggleVoice() { if (voiceEnabled.value) { voiceEnabled.value=false; stop(); } else { voiceEnabled.value=paused.value || speak(instruction.value); } }
function stopLocation() { locationEnabled.value=false; clearLocation?.(); clearLocation=null; clearInterval(staleTimer); position.value=null; quality.value='waiting'; streak=0; offRoute.value=false; lastTimestamp=0; }
function toggleLocation() {
  if (locationEnabled.value) { stopLocation(); return; }
  locationEnabled.value=true; locationError.value=''; quality.value='waiting';
  clearLocation=watchCoordinates(sample => {
    if (!Number.isFinite(sample.longitude) || !Number.isFinite(sample.latitude) || !Number.isFinite(sample.timestamp) || sample.timestamp > Date.now()+5000 || sample.timestamp <= lastTimestamp) return;
    lastTimestamp=sample.timestamp; const point=wgs84ToGcj02(sample.longitude,sample.latitude); position.value={...sample,point};
    const result=evaluatePosition(position.value,routePaths.value,streak); streak=result.streak; quality.value=result.quality;
    const newlyOff=result.offRoute && !offRoute.value; offRoute.value=result.offRoute;
    if (newlyOff && voiceEnabled.value && !paused.value) speak(locationMessage.value);
  }, error => { locationError.value=error.message; stopLocation(); });
  if (!locationEnabled.value) { clearLocation?.(); clearLocation=null; return; }
  staleTimer=setInterval(() => { if (position.value && Date.now()-position.value.timestamp>15000) { quality.value='stale'; streak=0; offRoute.value=false; } },3000);
}
onBeforeUnmount(() => { stop(); stopLocation(); });
</script>
<template>
  <section class="navigation-page journey-page">
    <aside class="navigation-side-panel journey-panel">
      <div class="journey-heading"><div><p class="section-kicker">{{ paused ? '在安全处歇一歇' : '一步一步，安心前行' }}</p><h1>{{ selectedRoute ? `约剩 ${remaining} 米` : '请选择路线' }}</h1></div><span class="journey-counter">{{ segments.length ? `${index+1} / ${segments.length} 段` : '暂无路段' }}</span><button class="journey-sos" type="button" :disabled="sosSubmitting" @click="$emit('send-sos')">{{ sosSubmitting ? '求助中…' : '紧急求助' }}</button></div>
      <p class="journey-estimate">根据手动完成路段估算 · 按{{ selectedProfile?.label || '当前出行情况' }}安排</p>
      <section class="journey-current" aria-label="当前路段" aria-live="polite"><span>当前路段</span><h2>{{ segment?.name || '请先返回路线方案' }}</h2><p>{{ segment?.explanation || '沿当前路段慢行，请以现场情况为准。' }}</p><p v-if="segment?.step_count > 0" class="journey-hazard">前方有 {{ segment.step_count }} 级台阶{{ segment.has_ramp ? '，记录有坡道，请现场确认入口。' : '，请注意脚下。' }}</p><p v-if="segment?.risk_tags?.length" class="journey-hazard">注意：{{ [...new Set(segment.risk_tags)].join('、') }}</p><p v-if="paused" class="journey-rest">已暂停播报和路段推进。在安全位置休息好，再继续。</p></section>
      <div class="journey-progress"><button type="button" :disabled="index <= 0 || paused" @click="advance(-1)">上一段</button><button class="journey-primary" type="button" :disabled="!segment || paused" @click="index < segments.length-1 ? advance(1) : confirmEnd=true">{{ index < segments.length-1 ? '已走完这段' : '核对目的地并结束' }}</button></div>
      <div class="journey-tools"><button type="button" :disabled="!segment" @click="toggleVoice">{{ voiceEnabled ? '关闭语音' : '开启语音提示' }}</button><button type="button" :disabled="!segment || paused" @click="speak(instruction)">{{ playing ? '重新播报' : '重播本段' }}</button><button type="button" :disabled="!segment" @click="paused=!paused">{{ paused ? '继续前行' : '休息一下' }}</button><button type="button" @click="toggleLocation">{{ locationEnabled ? '关闭定位' : '开启我的位置' }}</button></div>
      <p v-if="voiceError" class="journey-alert" role="alert">{{ voiceError }}</p><p class="journey-location" :class="{ 'journey-alert': offRoute }" role="status">{{ locationMessage }}</p>
      
      <details class="journey-directions"><summary>查看全程 {{ segments.length }} 段指引</summary><ol><li v-for="(item,i) in segments" :key="i" :aria-current="i===index ? 'step' : undefined"><strong>{{ i+1 }}. {{ item.name }}</strong><p>{{ buildSegmentInstruction(item,i,segments.length) }}</p></li></ol></details>
      <div class="journey-exit"><button type="button" @click="$emit('open-routes')">查看路线方案</button><button type="button" @click="confirmEnd=true">结束导航</button></div>
    </aside>
    <section class="navigation-map-panel journey-map" aria-label="当前规划路线地图">
      <AmapRouteMap v-if="pilotArea && !mapFailure" :current-segment-code="segment?.segment_code" :area="pilotArea" :features="mapFeatures" :route-segment-codes="routeSegmentCodes" :selected-segment-code="selectedSegmentCode || segment?.segment_code" :position="position" @select-segment="$emit('select-segment',$event)" @map-error="$emit('map-error',$event)" />
      <div v-else><p class="map-fallback-notice"><span>{{ mapFailure ? '底图暂不可用，使用路网示意' : '正在准备地图…' }}</span><button type="button" :disabled="mapRetrying" @click="$emit('retry-map')">重试底图</button></p><FallbackRouteMap :features="mapFeatures" :route-segment-codes="routeSegmentCodes" :selected-segment-code="selectedSegmentCode || segment?.segment_code" :position="position" @select-segment="$emit('select-segment',$event)" /></div>
    </section>
    <div v-if="confirmEnd" class="journey-dialog-backdrop"><section ref="endDialog" role="dialog" @keydown="trapDialog" aria-modal="true" aria-labelledby="end-title" class="journey-dialog" @keydown.esc="confirmEnd=false"><h2 id="end-title">确认结束这次导航？</h2><p>请现场确认是否到达目的地。结束导航不会自动验证到达。</p><button type="button" autofocus @click="confirmEnd=false">继续导航</button><button type="button" @click="confirmFinish">确认结束导航</button></section></div>
  </section>
</template>
<style scoped>
.journey-page { gap:16px; }.journey-panel { padding:22px; display:block; }.journey-current .journey-hazard { color:#915127; margin-top:8px; font-size:16px; }.journey-heading .journey-counter { font-size:13px; padding:8px; }.journey-heading .journey-sos { font-size:14px; padding:8px; max-width:80px; }.journey-exit { margin-top:12px; }.journey-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; }.journey-heading h1 { margin:8px 0; font-size:32px; letter-spacing:-1px; }.journey-counter { border-radius:20px; background:#e5eee6; padding:8px 12px; color:#225441; white-space:nowrap; font-weight:700; }.journey-estimate { margin:4px 0 18px; font-size:14px; color:#66786b; }.journey-current { padding:18px; background:#edf5ee; border:1px solid #c7dcca; border-radius:18px; }.journey-current>span { font-size:13px; color:#54715b; }.journey-current h2 { font-size:25px; margin:6px 0 10px; }.journey-current p { line-height:1.85; margin:0; }.journey-progress { display:grid; grid-template-columns:1fr 2fr; gap:10px; margin:14px 0; }.journey-page button { min-height:48px; border:1px solid #c9d6c9; border-radius:12px; color:#264d3b; background:#fff; font:inherit; font-weight:650; padding:10px 12px; }.journey-page button:disabled { opacity:.45; }.journey-page .journey-primary { background:#245d47; color:white; border-color:#245d47; }.journey-tools { display:grid; grid-template-columns:1fr 1fr; gap:8px; }.journey-location { font-size:14px; line-height:1.7; color:#526a59; background:#f4f7f2; padding:10px 12px; border-radius:12px; }.journey-alert { color:#94451e; background:#fff1df; padding:10px; border-radius:10px; }.journey-rest { color:#805425; margin-top:10px!important; }.journey-directions { margin:14px 0; }.journey-directions summary { cursor:pointer; padding:14px 0; min-height:44px; font-weight:650; }.journey-directions ol { padding-left:22px; }.journey-directions li { padding:10px 4px; line-height:1.7; }.journey-directions p { margin:5px 0; color:#52685a; }.journey-directions [aria-current] { color:#18563f; }.journey-exit { display:flex; flex-wrap:wrap; gap:8px; }.journey-page .journey-sos { color:#963e30; border-color:#e8c1b6; background:#fff1eb; }.journey-map { min-width:0; border-radius:22px; overflow:hidden; }.journey-dialog-backdrop { position:fixed; inset:0; background:#15291d88; z-index:3000; display:grid; place-items:center; padding:20px; }.journey-dialog { background:#fffdf7; padding:24px; border-radius:22px; max-width:420px; box-shadow:0 20px 70px #0003; }.journey-dialog h2 { margin-top:0; }.journey-dialog p { line-height:1.8; }.journey-dialog button { width:100%; margin-top:10px; }
@media(max-width:767px) { .journey-page { display:flex; flex-direction:column; }.journey-page { background:#fffdf7; border-radius:22px; padding:16px; }.journey-panel { display:contents; }.journey-heading { order:0; position:sticky; top:0; z-index:85; background:#fffdf7; padding:8px 0; }.journey-estimate { order:1; margin:0; }.journey-current { order:2; }.journey-map { order:3!important; height:300px; min-height:300px!important; margin:0; box-shadow:none; border:1px solid #d5e2d7; }.journey-map :deep(.amap-route-map), .journey-map :deep(.campus-map) { height:220px!important; min-height:140px!important; }.journey-progress { order:4; margin:0; position:sticky; bottom:0; z-index:84; background:#fffdf7; padding:8px 0; }.journey-tools { order:5; }.journey-location, .journey-alert, .map-fallback-notice { order:6; margin:0; }.journey-directions { order:7; margin:0; }.journey-exit { order:8; margin:0; }.journey-heading h1 { font-size:29px; }.journey-current h2 { font-size:23px; }.journey-map .map-fallback-notice { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:13px; font-weight:400; padding:8px; margin:0; line-height:1.5; }.journey-map :deep(.fallback-map-note) { font-size:12px; padding:5px 10px; line-height:1.5; }.journey-map :deep(.amap-route-map) { height:300px!important; min-height:300px!important; }.journey-progress button { padding:10px 8px; } }
</style>
