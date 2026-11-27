<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import AmapRouteMap from '../components/AmapRouteMap.vue';
import FallbackRouteMap from '../components/FallbackRouteMap.vue';
import { createSpeechOutput, buildSegmentInstruction } from '../services/speechOutput.js';
import { createNavigationWakeLock } from '../services/navigationWakeLock.js';
import { watchCoordinates } from '../services/deviceLocation.js';
import { evaluatePosition, remainingDistance, wgs84ToGcj02 } from '../services/navigationJourney.js';
import { arrivalBoundaryText } from '../utils/arrivalBoundary.js';
import { manualRemainingDistance, navigationRows, registeredSegmentText } from '../utils/navigationText.js';
import { buildCurrentStepBrief } from '../utils/navigationBrief.js';
import { buildRouteMemo } from '../utils/navigationMemo.js';
import { buildNavigationPhotoCue, PHOTO_CUE_CAVEAT } from '../utils/navigationPhotoCue.js';
import { createRouteMemoDownload, routeMemoDownloadSupported } from '../services/routeMemoDownload.js';
import { navigationRest } from '../utils/navigationRest.js';
import { navigationRestPlan } from '../utils/navigationRestPlan.js';
import { WALKING_BUDGETS } from '../utils/walkingBudget.js';
import { navigationRestWaypoint } from '../utils/navigationRestWaypoint.js';
import { navigationStairs, buildAheadSummary } from '../utils/navigationAhead.js';
import { freshMapPosition, inMapCoverage, registeredRoadFeatures, routePartState, routePartLabel, segmentGeometry, validMapPoint } from '../utils/navigationMap.js';
const props = defineProps({ manualUndo: Object, undoManualConfirmation: { type: Function, default: () => false }, arrivalSession: { type: Number, default: 0 }, manualConfirmedCount: { type: Number, default: 0 }, apiBaseUrl: { type: String, default: '' }, textMemoRouteVerified: Boolean, memoScope: { type: Number, default: 0 }, obstructionState: { type: Object, default: () => ({ options: [], reason: '当前路线未确认，暂不能选择绕开路段。' }) }, guidancePaused: Boolean, detourActive: Boolean, selectedRoute: Object, selectedProfile: Object, mapFeatures: { type: Array, default: () => [] }, pilotArea: Object, mapFailure: String, mapRetrying: Boolean, selectedSegmentCode: String, sosSubmitting: Boolean, progress: { type: Object, default: () => ({ index:0, paused:false }) } });
const emit = defineEmits(['open-routes','end-navigation','request-detour-end','retry-map','select-segment','map-error','send-sos','progress','pause-detour','confirm-obstruction','confirm-manual-segment','discard-manual-undo']);
// Keep malformed road coordinates out of both map renderers. Retain identities so
// an invalid duplicate cannot make a different row appear uniquely registered.
const navigationFeatures = computed(() => props.mapFeatures.filter(feature => feature && typeof feature === 'object').map(feature => {
  if (feature.properties?.kind !== 'segment') return feature;
  const coordinates = feature.geometry?.coordinates;
  return feature.geometry?.type === 'LineString' && Array.isArray(coordinates) && coordinates.length > 1
    && coordinates.filter(validMapPoint).length === coordinates.length ? feature : { ...feature, geometry: null };
}));
const endDialog = ref(null);
const endTrigger = ref(null);
const endActions = ref(null);
let endAlive = true, endRequest = null;
function openEnd(event) {
  if (!endAlive || restClosed.value || props.guidancePaused || confirmEnd.value) return;
  endTrigger.value = event?.currentTarget;
  endRequest = { route: props.selectedRoute, session: props.arrivalSession, scope: props.memoScope, detour: props.detourActive };
  const request = endRequest;
  endActions.value = { arrived: () => confirmFinish('arrived', request), unconfirmed: () => confirmFinish('unconfirmed', request),
    legacy: () => confirmFinish(undefined, request), dismiss: () => dismissEnd(request) };
  confirmEnd.value = true;
}
async function dismissEnd(request) {
  if (!request || request !== endRequest) return;
  confirmEnd.value = false; endRequest = null;
  const trigger = endTrigger.value;
  await nextTick();
  if (endAlive && !confirmEnd.value && !restClosed.value) trigger?.focus();
}
watch([() => props.selectedRoute, () => props.arrivalSession, () => props.memoScope,
  () => props.guidancePaused, () => props.detourActive], () => {
  confirmEnd.value = false; endRequest = null;
}, { flush: 'sync' });
onBeforeUnmount(() => { endAlive = false; endRequest = null; });
const showMap = ref(true);
const restClosed = ref(false);
const index = ref(Number.isInteger(props.progress.index) && props.progress.index >= 0 && props.progress.index < (props.selectedRoute?.segment_codes?.length || 0) ? props.progress.index : 0); const paused = ref(Boolean(props.progress.paused)); const voiceEnabled = ref(false); const confirmEnd = ref(false);
const obstructionDraft = ref(null), obstructionChoice = ref(null), obstructionHeading = ref(null), obstructionButton = ref(null);
async function openObstruction() {
  if (props.guidancePaused || props.detourActive || !props.obstructionState.options.length) return;
  obstructionDraft.value = [...props.obstructionState.options]; obstructionChoice.value = null;
  await nextTick(); obstructionHeading.value?.focus();
}
function closeObstruction() {
  obstructionDraft.value = null; obstructionChoice.value = null;
}
async function cancelObstruction() {
  closeObstruction(); await nextTick(); obstructionButton.value?.focus();
}
function confirmObstruction() {
  const choice = obstructionDraft.value?.find(option => option === obstructionChoice.value);
  if (!choice || props.guidancePaused || props.detourActive || choice.route !== props.selectedRoute
      || choice.manualIndex !== index.value) return;
  emit('confirm-obstruction', choice);
}
watch([() => props.selectedRoute, () => props.obstructionState, index, confirmEnd], closeObstruction, { flush: 'sync' });
watch(confirmEnd, async value => { if (value) { stop(); await nextTick(); if (confirmEnd.value && endAlive) endDialog.value?.querySelector('button')?.focus(); } });
function trapDialog(event) { if (event.key !== 'Tab') return; const buttons=endDialog.value?.querySelectorAll('button'); if (!buttons?.length) return; const first=buttons[0],last=buttons[buttons.length-1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
const platformSpeech = globalThis.speechSynthesis;
let localSummaryVoice = null;
const { playing, error: voiceError, speak: speakOutput, stop } = createSpeechOutput({ synthesis: platformSpeech && {
  cancel: () => platformSpeech.cancel(),
  getVoices: () => localSummaryVoice ? [localSummaryVoice] : platformSpeech.getVoices(),
  speak: utterance => platformSpeech.speak(utterance),
} });
const segments = computed(() => navigationRows(props.selectedRoute));
const segment = computed(() => segments.value[index.value]);
// A page-local reading preference. Ordinary rest and manual progress keep it;
// route/session exits clear it without touching guidance or device services.
const largeText = ref(false);
let largeTextAlive = true;
const largeTextBlocked = computed(() => !largeTextAlive || !props.selectedRoute || !segment.value
  || props.guidancePaused || confirmEnd.value || restClosed.value
  || Boolean(obstructionDraft.value));
function toggleLargeText() {
  if (!largeTextAlive || largeTextBlocked.value) return;
  largeText.value = !largeText.value;
}
watch([() => props.selectedRoute, () => props.selectedProfile, () => props.pilotArea,
  () => props.memoScope, () => props.guidancePaused, () => props.detourActive,
  confirmEnd, restClosed, obstructionDraft], () => { largeText.value = false; }, { flush: 'sync' });
watch(largeTextBlocked, blocked => { if (blocked) largeText.value = false; }, { flush: 'sync' });
onBeforeUnmount(() => { largeTextAlive = false; largeText.value = false; });
const segmentText = computed(() => registeredSegmentText(segment.value));
const currentStepBrief = computed(() => buildCurrentStepBrief(props.selectedRoute, index.value));
const briefText = ref(''), briefSpeaking = ref(false);
const briefBlocked = computed(() => paused.value || props.guidancePaused || confirmEnd.value || restClosed.value || !currentStepBrief.value);
// A brief shares the controlled speech channel, but never changes automatic voice.
watch(playing, value => { if (!value) briefSpeaking.value = false; }, { flush: 'sync' });
function clearBrief() {
  if (briefText.value) { stop(); voiceError.value = ''; }
  briefText.value = ''; briefSpeaking.value = false;
}
function speak(text) { clearBrief(); return speakOutput(text); }
function hearCurrentBrief() {
  if (briefBlocked.value) return;
  briefText.value = currentStepBrief.value;
  briefSpeaking.value = speakOutput(briefText.value, { rate: 0.70, localOnly: true }) && playing.value;
}
watch([paused, index, confirmEnd, restClosed, () => props.selectedRoute, () => props.guidancePaused,
  () => props.selectedProfile, () => props.pilotArea, () => props.detourActive], clearBrief, { deep: true, flush: 'sync' });
// This disclosure has its own read-only channel. It never calls guidance, map,
// speech, location, publisher, wake lock, storage or a route/session action.
const memoText = ref(''), memoStatus = ref(''), memoDownloadSupported = ref(false);
const memoDownload = createRouteMemoDownload();
let memoAlive = true;
const memoBlocked = computed(() => !memoAlive || props.guidancePaused || props.detourActive
  || confirmEnd.value || restClosed.value || Boolean(obstructionDraft.value));
const memoManifest = computed(() => buildRouteMemo(props.selectedRoute, props.mapFeatures,
  { verifiedOrdinary: props.textMemoRouteVerified && !memoBlocked.value }));
const memoUnavailableReason = computed(() => memoBlocked.value
  ? '本次引导已暂停、正在核对障碍或已结束，文字路线暂不可用。'
  : !props.textMemoRouteVerified ? '仅本次已确认开始的普通登记路线可保存；定位起点、绕行或未确认路线暂不可用。'
  : memoManifest.value.reason);
function clearMemo() {
  memoText.value = ''; memoStatus.value = ''; memoDownload.dispose();
}
function toggleMemo() {
  if (!memoAlive || memoBlocked.value || !memoManifest.value.available) return;
  if (memoText.value) { clearMemo(); return; }
  memoDownloadSupported.value = routeMemoDownloadSupported();
  memoStatus.value = ''; memoText.value = memoManifest.value.text;
}
function downloadMemo(event) {
  // Recheck the current evidence, including stale captured handlers after exit.
  if (!memoAlive || memoBlocked.value || !memoManifest.value.available || !memoText.value
      || memoText.value !== memoManifest.value.text) { clearMemo(); return; }
  const result = memoDownload.download(memoText.value, event);
  if (result === 'unsupported') {
    memoDownloadSupported.value = false;
    memoStatus.value = '此环境无法请求浏览器下载；请直接选择下方文字。';
  } else if (result === 'error') {
    memoStatus.value = '未能请求浏览器下载；请直接选择下方文字，或稍后重试。';
  } else {
    memoStatus.value = '已向浏览器请求下载，无法确认是否保存；请检查浏览器下载列表。下方文字仍可选择。';
  }
}
watch([paused, index, confirmEnd, restClosed, obstructionDraft, () => props.selectedRoute,
  () => props.guidancePaused, () => props.detourActive, () => props.selectedProfile,
  () => props.pilotArea, () => props.mapFeatures, () => props.textMemoRouteVerified, () => props.memoScope],
  clearMemo, { deep: true, flush: 'sync' });
onBeforeUnmount(() => { memoAlive = false; clearMemo(); });
// The legacy page normalizes malformed initial progress to zero for text UI.
// That default cannot establish a confirmed manual step or override parent progress.
const manualStepConfirmed = computed(() => Number.isInteger(props.progress?.index)
  && props.progress.index >= 0 && props.progress.index === index.value);
// Reuse the memo's strict ordinary-route/unique registered-name proof, but show
// only the visible manual step. An ordinary rest pause is still eligible.
const showStepOpen = ref(false), showStepButton = ref(null), showStepCard = ref(null);
let showStepAlive = true;
const showStepBlocked = computed(() => !showStepAlive || memoBlocked.value
  || !manualStepConfirmed.value || !memoManifest.value.available);
const showStepReason = computed(() => !manualStepConfirmed.value
  ? '手动路线步骤未确认，暂不能展示；请核对当前文字指引。'
  : memoBlocked.value ? '正在核对障碍、绕行或结束引导，暂不能展示。'
  : !props.textMemoRouteVerified ? '仅本次已确认开始的普通登记路线可展示；定位起点或未确认路线暂不可用。'
  : '登记路线或路段资料未完整核对，暂不能展示；请核对当前文字指引。');
function clearShowStep() { showStepOpen.value = false; }
async function closeShowStep() {
  clearShowStep(); await nextTick(); if (showStepAlive) showStepButton.value?.focus();
}
function closeShowStepOnEscape(event) {
  if (!showStepAlive || !showStepOpen.value) return;
  event.preventDefault(); event.stopPropagation();
  return closeShowStep();
}
async function openShowStep() {
  if (!showStepAlive || showStepBlocked.value) return;
  showStepOpen.value = true;
  await nextTick(); if (showStepAlive && showStepOpen.value) showStepCard.value?.focus();
}
watch([paused, index, confirmEnd, restClosed, obstructionDraft, () => props.progress, () => props.selectedRoute,
  () => props.guidancePaused, () => props.detourActive, () => props.selectedProfile, () => props.pilotArea,
  () => props.mapFeatures, () => props.textMemoRouteVerified, () => props.memoScope],
  clearShowStep, { deep: true, flush: 'sync' });
onBeforeUnmount(() => { showStepAlive = false; clearShowStep(); });
// Only an explicit disclosure mounts a single registered derivative. This state
// never calls map, progress, speech, location, wake, storage or session actions.
const cueOpen = ref(false), cueStepIndex = ref(0), cuePhotoIndex = ref(0), cueFailed = ref(false);
const cueButton = ref(null), cueCloseButton = ref(null), cueImage = ref(null);
let cueAlive = true;
const cueBlocked = computed(() => !cueAlive || !manualStepConfirmed.value || paused.value || props.progress?.paused
  || props.guidancePaused || props.detourActive
  || confirmEnd.value || restClosed.value || Boolean(obstructionDraft.value));
const cueManifest = computed(() => buildNavigationPhotoCue(props.selectedRoute, props.mapFeatures, index.value,
  { verifiedOrdinary: props.textMemoRouteVerified && !cueBlocked.value, apiBaseUrl: props.apiBaseUrl }));
const cueUnavailableReason = computed(() => !manualStepConfirmed.value
  ? '手动路线步骤未确认，实景暂不可用；请核对当前文字指引。'
  : cueBlocked.value
  ? '正在休息、核对障碍或结束引导，实景暂不可用；请使用文字指引。'
  : cueManifest.value.reason);
const cueStep = computed(() => cueOpen.value && !cueBlocked.value && cueManifest.value.available
  ? cueManifest.value.steps[cueStepIndex.value] : null);
const cuePhoto = computed(() => cueStep.value?.photos[cuePhotoIndex.value]);
function clearCue() {
  cueOpen.value = false; cueStepIndex.value = 0; cuePhotoIndex.value = 0; cueFailed.value = false;
}
async function closeCue() {
  clearCue(); await nextTick(); if (cueAlive) cueButton.value?.focus();
}
async function toggleCue() {
  if (!cueAlive || cueBlocked.value || !cueManifest.value.available) return;
  if (cueOpen.value) { await closeCue(); return; }
  cueStepIndex.value = 0; cuePhotoIndex.value = 0; cueFailed.value = false; cueOpen.value = true;
  await nextTick(); if (cueOpen.value && cueAlive) cueCloseButton.value?.focus();
}
function selectCueStep(stepIndex) {
  if (!cueAlive || !cueOpen.value || cueBlocked.value || !cueManifest.value.steps[stepIndex]
      || stepIndex === cueStepIndex.value) return;
  cueStepIndex.value = stepIndex; cuePhotoIndex.value = 0; cueFailed.value = false;
}
function moveCuePhoto(delta) {
  const next = cuePhotoIndex.value + delta;
  if (!cueAlive || !cueOpen.value || cueBlocked.value || !cueStep.value?.photos[next]) return;
  cuePhotoIndex.value = next; cueFailed.value = false;
}
function markCueFailed(event) {
  if (cueAlive && cueOpen.value && event.target === cueImage.value) cueFailed.value = true;
}
watch([paused, index, confirmEnd, restClosed, obstructionDraft, () => props.progress, () => props.selectedRoute,
  () => props.guidancePaused, () => props.detourActive, () => props.selectedProfile, () => props.pilotArea,
  () => props.mapFeatures, () => props.textMemoRouteVerified, () => props.memoScope, () => props.apiBaseUrl],
  clearCue, { deep: true, flush: 'sync' });
onBeforeUnmount(() => { cueAlive = false; clearCue(); });
const displayedRemaining = computed(() => manualRemainingDistance(props.selectedRoute,index.value));
const restHint = computed(() => navigationRest(props.selectedRoute, index.value, {
  paused: paused.value || props.guidancePaused || confirmEnd.value, active: !restClosed.value,
}));
const walkingPlan = ref(null);
watch(() => props.selectedRoute, () => { walkingPlan.value = null; }, { deep: true, flush: 'sync' });
const restPlan = computed(() => navigationRestPlan(props.selectedRoute, index.value, walkingPlan.value, {
  paused: paused.value || props.guidancePaused || confirmEnd.value, active: !restClosed.value,
}));
function changeWalkingPlan(event) {
  const value = event.target.value;
  walkingPlan.value = WALKING_BUDGETS.find(budget => String(budget) === value) ?? null;
}
const pausedRestOpen = ref(false);
const pausedRestAvailable = computed(() => paused.value && !props.guidancePaused && !confirmEnd.value && !restClosed.value);
// Explicit read-only disclosure at the frozen MANUAL step. Keep the normal
// restHint/restPlan hidden while paused; this result never feeds map or speech.
const pausedRestPreview = computed(() => {
  if (!pausedRestAvailable.value || !pausedRestOpen.value) return null;
  const hint = navigationRest(props.selectedRoute, index.value);
  return {
    hint: hint.state === 'hidden' ? { state: 'unknown', text: '当前路线暂未确认，无法估算前方休息点；请先核对路线。' } : hint,
    plan: navigationRestPlan(props.selectedRoute, index.value, walkingPlan.value),
  };
});
function togglePausedRestPreview() {
  if (pausedRestAvailable.value) pausedRestOpen.value = !pausedRestOpen.value;
}
watch([paused, index, confirmEnd, restClosed, () => props.selectedRoute, () => props.guidancePaused,
  () => props.selectedProfile, () => props.pilotArea, () => props.detourActive],
  () => { pausedRestOpen.value = false; }, { deep: true, flush: 'sync' });
// Use raw map evidence here so sanitation cannot conceal invalid duplicates.
const restWaypoint = computed(() => navigationRestWaypoint(props.selectedRoute, index.value, restHint.value, props.mapFeatures));
const aheadBlocked = computed(() => paused.value || props.guidancePaused || confirmEnd.value || restClosed.value || !segment.value);
const wakeLock = createNavigationWakeLock({ eligible: () => !aheadBlocked.value });
const { state: wakeState, message: wakeMessage, busy: wakeBusy } = wakeLock;
watch(aheadBlocked, blocked => { if (blocked) wakeLock.disable(); }, { flush: 'sync' });
watch([() => props.selectedRoute, () => props.selectedProfile, () => props.pilotArea, () => props.detourActive],
  () => wakeLock.disable(), { deep: true, flush: 'sync' });
onBeforeUnmount(wakeLock.dispose);
const stairHint = computed(() => navigationStairs(props.selectedRoute, index.value, {
  paused: paused.value || props.guidancePaused || confirmEnd.value, active: !restClosed.value,
}));
const stairGeometry = computed(() => segmentGeometry(navigationFeatures.value, stairHint.value.code));
const aheadSummary = computed(() => buildAheadSummary(stairHint.value, restHint.value));
const summaryRequested = ref(false);
const summaryError = ref('');
function hearAhead() {
  if (aheadBlocked.value) return;
  clearBrief();
  summaryRequested.value=true; summaryError.value='';
  // Keep this one-shot action offline: an unspecified platform voice may be remote.
  if (platformSpeech) {
    try { localSummaryVoice = platformSpeech.getVoices().find(voice => /^zh/i.test(voice.lang) && voice.localService === true) || null; } catch { localSummaryVoice=null; }
    if (!localSummaryVoice) { stop(); summaryError.value='本地中文语音暂不可用，请查看下方前方情况文字，稍后可再次点击。'; return; }
  }
  try { speak(aheadSummary.value); } finally { localSummaryVoice=null; }
}
function leaveRoutes() { restClosed.value = true; stop(); emit('open-routes'); }
const instruction = computed(() => buildSegmentInstruction(segment.value,index.value,segments.value.length));
const remaining = computed(() => remainingDistance(props.selectedRoute,index.value));
const routeSegmentCodes = computed(() => new Set(props.selectedRoute?.segment_codes || []));
const routePaths = computed(() => registeredRoadFeatures(navigationFeatures.value).filter(f => routeSegmentCodes.value.has(f.properties.segment_code)).map(f => f.geometry.coordinates));
const locationEnabled = ref(false); const position = ref(null); const locationError = ref(''); const quality = ref('waiting'); const offRoute = ref(false);
const followRequested = ref(true);
const mapView = ref('current');
const previewNext = ref(false);
const inspectionCode = ref(null);
const nextSegment = computed(() => segments.value[index.value+1]);
const nextSegmentText = computed(() => registeredSegmentText(nextSegment.value));
const currentGeometry = computed(() => segmentGeometry(navigationFeatures.value,segment.value?.segment_code));
const nextGeometry = computed(() => segmentGeometry(navigationFeatures.value,nextSegment.value?.segment_code));
const mapSelectedCode = computed(() => inspectionCode.value || segment.value?.segment_code);
const cameraRequest = ref(null);
let cameraRevision = 0;
const mapPosition = computed(() => freshMapPosition(position.value, quality.value, locationEnabled.value && !paused.value && !props.guidancePaused, props.pilotArea, navigationFeatures.value));
const following = computed(() => followRequested.value && !offRoute.value && Boolean(mapPosition.value));
const outsideCoverage = computed(() => position.value && !inMapCoverage(position.value.point, props.pilotArea, navigationFeatures.value));
const recoveryIssue = computed(() => {
  if (!segment.value || paused.value || props.guidancePaused || props.detourActive || confirmEnd.value || restClosed.value) return null;
  if (locationError.value) return /权限/.test(locationError.value)
    ? '定位权限未开启，无法用定位核对所在路段。'
    : '定位暂不可用，无法用定位核对所在路段。';
  if (!locationEnabled.value) return null;
  if (quality.value === 'poor') return '定位精度较低，暂不能判断您是否沿本段前行。';
  if (quality.value === 'stale') return '位置已过期或无效，不能作为当前所在路段的依据。';
  if (outsideCoverage.value) return '位置超出登记地图覆盖范围，请先核对现场地点。';
  if (offRoute.value) return '您可能偏离登记路线，请先在安全处停下核对。';
  if (quality.value === 'no-route') return '缺少路线图形，暂不能用定位核对是否偏离。';
  return null;
});
// Manual disclosure shares the existing recovery card and actions. Keep automatic
// GPS failures independent so closing this disclosure never dismisses a failure.
const manualRecoveryOpen = ref(false), manualRecoveryButton = ref(null), recoveryCard = ref(null);
let recoveryAlive = true;
const manualRecoveryAvailable = computed(() => recoveryAlive && !memoBlocked.value && !paused.value
  && !props.progress?.paused && manualStepConfirmed.value && memoManifest.value.available);
const recoveryVisible = computed(() => Boolean(recoveryIssue.value)
  || (manualRecoveryOpen.value && manualRecoveryAvailable.value));
function clearManualRecovery() { manualRecoveryOpen.value = false; }
async function openManualRecovery() {
  if (!manualRecoveryAvailable.value) return;
  manualRecoveryOpen.value = true;
  await nextTick(); if (recoveryAlive && manualRecoveryOpen.value) recoveryCard.value?.focus();
}
async function closeManualRecovery() {
  if (!recoveryAlive || !manualRecoveryOpen.value) return;
  clearManualRecovery();
  await nextTick();
  if (manualRecoveryAvailable.value && !manualRecoveryOpen.value) manualRecoveryButton.value?.focus();
}
function closeManualRecoveryOnEscape(event) {
  if (!recoveryAlive || !manualRecoveryOpen.value) return;
  event.preventDefault(); event.stopPropagation();
  return closeManualRecovery();
}
watch([paused, index, confirmEnd, restClosed, obstructionDraft, () => props.progress, () => props.selectedRoute,
  () => props.guidancePaused, () => props.detourActive, () => props.selectedProfile, () => props.pilotArea,
  () => props.mapFeatures, () => props.textMemoRouteVerified, () => props.memoScope, () => props.arrivalSession],
  clearManualRecovery, { deep: true, flush: 'sync' });
onBeforeUnmount(() => { recoveryAlive = false; clearManualRecovery(); });
function recoverNavigation(mode) {
  if (!recoveryAlive || !recoveryVisible.value) return;
  if (mode === 'map') {
    if (!currentGeometry.value) return;
    showMap.value=true; requestCamera('current', false);
  } else if (mode === 'text') {
    showMap.value=false; previewNext.value=false; inspectionCode.value=null;
    followRequested.value=false; mapView.value='current';
  }
}
const followMessage = computed(() => paused.value ? '正在原地休息，已暂停位置跟随；仍可手动查看地图。' : following.value ? '正在跟随新鲜、精度良好的位置；不会自动推进路段。' :
  mapView.value === 'rest' && restWaypoint.value ? '正在查看下一登记休息点的路网节点；示意图固定显示，不代表座椅位置或实时到达，手动进度未改变。' :
  mapView.value === 'inspection' && ['current','ahead'].includes(stairHint.value.state) && inspectionCode.value === stairHint.value.code ? '正在查看含台阶的登记路段，已停止位置跟随；不改变手动进度，也不表示台阶的具体位置。' :
  previewNext.value ? `正在预览下一登记路段；当前仍为第 ${index.value+1} 段。预览不计进度。` :
  mapView.value === 'overview' ? '正在浏览全程；当前路段仍按手动确认进度。' :
  mapView.value === 'inspection' ? '正在浏览地图；已停止跟随，当前路段未改变。' :
  followRequested.value && locationEnabled.value ? '等待可用位置，地图不会自动移动。' : '当前路段视图；可开启定位后跟随，或手动浏览地图。');
function browseMap() { discardManualUndo(); followRequested.value=false; mapView.value='inspection'; }
function inspectSegment(code) { previewNext.value=false; inspectionCode.value=code; browseMap(); emit('select-segment',code); }
function requestCamera(kind, selectCurrent = true) { previewNext.value=false; if (selectCurrent) inspectionCode.value=null; followRequested.value=kind==='follow'; mapView.value=kind; cameraRequest.value={kind,code:segment.value?.segment_code,revision:++cameraRevision}; if (selectCurrent && (kind==='current' || kind==='follow')) emit('select-segment',segment.value?.segment_code); }
function previewNextSegment() {
  if (!nextSegment.value || props.guidancePaused) return;
  previewNext.value=true; followRequested.value=false; mapView.value='next';
  inspectionCode.value=nextGeometry.value ? nextSegment.value.segment_code : null;
  if (nextGeometry.value) cameraRequest.value={kind:'segment',code:nextSegment.value.segment_code,revision:++cameraRevision};
}
function inspectStairSegment() {
  if (aheadBlocked.value || !stairGeometry.value || !['current','ahead'].includes(stairHint.value.state)) return;
  showMap.value=true; previewNext.value=false; followRequested.value=false; mapView.value='inspection';
  inspectionCode.value=stairHint.value.code;
  cameraRequest.value={kind:'segment',code:stairHint.value.code,revision:++cameraRevision};
  emit('select-segment',stairHint.value.code);
  void nextTick(() => globalThis.document?.getElementById('optional-navigation-map')?.scrollIntoView?.({ block:'nearest' }));
}
function inspectRestWaypoint() {
  if (aheadBlocked.value || !restWaypoint.value) return;
  showMap.value=true; previewNext.value=false; followRequested.value=false;
  inspectionCode.value=null; mapView.value='rest';
  cameraRequest.value={kind:'rest',nodeCode:restWaypoint.value.nodeCode,revision:++cameraRevision};
  void nextTick(() => globalThis.document?.getElementById('optional-navigation-map')?.scrollIntoView?.({ block:'nearest' }));
}
function resumeFollow() { if (!paused.value && !props.guidancePaused && freshMapPosition(position.value,quality.value,locationEnabled.value,props.pilotArea,navigationFeatures.value)) requestCamera('follow'); }
function pauseNavigation() { if (props.guidancePaused || !segment.value || confirmEnd.value) return; paused.value=true; stop(); }
function resumeNavigation() { if (props.guidancePaused || !segment.value || confirmEnd.value) return; paused.value=false; }
let clearLocation; let streak = 0; let lastTimestamp = 0; let staleTimer;
const locationMessage = computed(() => locationError.value || (!locationEnabled.value ? '定位未开启，您可以按文字逐段前行。' : quality.value === 'waiting' ? '正在获取位置…' : quality.value === 'stale' ? '位置已过期或无效，请停在安全处等待定位；地图不会自动移动。' : quality.value === 'poor' ? '定位精度较低，暂不判断偏离；地图不会自动移动。' : quality.value === 'no-route' ? '位置已获取，缺少路线图形，暂不判断偏离；地图不会自动移动。' : outsideCoverage.value ? '位置超出登记地图覆盖范围，请核对地点；不会吸附道路或自动移动地图。' : offRoute.value ? '您可能偏离路线，请先在安全处停下，核对地图。' : `位置已更新，精度约${Math.round(position.value?.accuracy || 0)}米。`));
function confirmFinish(outcome, request) {
  if (!endAlive || restClosed.value || !confirmEnd.value || !request || request !== endRequest
      || request.route !== props.selectedRoute || request.session !== props.arrivalSession
      || request.scope !== props.memoScope || request.detour !== props.detourActive || props.guidancePaused) return;
  if (!props.detourActive && !['arrived', 'unconfirmed'].includes(outcome)) return;
  endRequest = null; restClosed.value=true; stop(); stopLocation(); voiceEnabled.value=false; confirmEnd.value=false;
  emit('end-navigation', props.detourActive ? undefined : { outcome, session: request.session, route: request.route });
}
function markManualSegment() {
  if (!endAlive || restClosed.value || paused.value || props.guidancePaused || props.detourActive
      || confirmEnd.value || !segment.value || !props.arrivalSession) return;
  discardManualUndo();
  emit('confirm-manual-segment', { session: props.arrivalSession, route: props.selectedRoute, index: index.value });
}
// The receipt owns count and capability; this page owns only the manual step.
const manualConfirmButton = ref(null), manualUndoStatus = ref('');
let manualUndoAlive = true, undoFocusVersion = 0, silentUndo = false;
const manualUndoBlocked = computed(() => !manualUndoAlive || !props.arrivalSession || !manualStepConfirmed.value
  || paused.value || props.progress?.paused || props.guidancePaused || props.detourActive
  || confirmEnd.value || restClosed.value || Boolean(obstructionDraft.value));
function discardManualUndo() {
  undoFocusVersion++; manualUndoStatus.value = '';
  emit('discard-manual-undo', { session: props.arrivalSession, route: props.selectedRoute });
}
function discardUndoOnOtherAction(event) {
  const control = event.target?.closest?.('button, a, input, select, summary');
  if (control && !control.hasAttribute('data-manual-confirmation')) discardManualUndo();
}
// v-for binds each handler to this capability, never to a later prop value.
const manualUndoActions = computed(() => {
  const token = props.manualUndo;
  return token && !manualUndoBlocked.value && token.session === props.arrivalSession
    && token.route === props.selectedRoute && token.nextIndex === index.value
    ? [{ token, undo: () => undoManualSegment(token) }] : [];
});
async function undoManualSegment(token) {
  if (manualUndoBlocked.value || !token || token !== props.manualUndo
      || token.session !== props.arrivalSession || token.route !== props.selectedRoute
      || token.nextIndex !== index.value || !props.undoManualConfirmation(token)) return;
  const focusVersion = ++undoFocusVersion;
  // No requestCamera/select-segment/follow/locate. The existing index watcher
  // publishes ordinary progress once and consumes this one-time voice silence.
  if (index.value !== token.index) { silentUndo = true; index.value = token.index; }
  stop(); manualUndoStatus.value = `已撤销刚才的确认，请核对第 ${token.index + 1} 段后再继续。`;
  await nextTick(); silentUndo = false;
  if (manualUndoAlive && focusVersion === undoFocusVersion && !manualUndoBlocked.value
      && token.session === props.arrivalSession && token.route === props.selectedRoute
      && index.value === token.index) manualConfirmButton.value?.focus();
}
watch([paused, confirmEnd, restClosed, obstructionDraft, manualRecoveryOpen,
  () => props.selectedRoute, () => props.arrivalSession, () => props.memoScope,
  () => props.selectedProfile, () => props.pilotArea, () => props.guidancePaused, () => props.detourActive],
  discardManualUndo, { deep: true, flush: 'sync' });
watch(() => props.progress.index, value => {
  if (props.manualUndo && value !== props.manualUndo.nextIndex) discardManualUndo();
}, { flush: 'sync' });
onBeforeUnmount(() => { manualUndoAlive = false; discardManualUndo(); });
function publish() { if (props.guidancePaused || !props.selectedRoute) return; emit('progress', { index:index.value, paused:paused.value, remaining:remaining.value, instruction:`${paused.value ? '正在休息。' : ''}${instruction.value}` }); }
watch([() => props.selectedRoute, () => props.guidancePaused], () => { index.value=0; paused.value=false; voiceEnabled.value=false; summaryRequested.value=false; summaryError.value=''; stop(); showMap.value=true; confirmEnd.value=false; streak=0; offRoute.value=false; locationError.value=''; stopLocation(); requestCamera('current'); publish(); }, { flush: 'sync' });
watch([index,paused], () => { publish(); if (!silentUndo && !props.guidancePaused && props.selectedRoute && voiceEnabled.value && !paused.value) speak(instruction.value); else stop(); silentUndo = false; });
onMounted(() => emit('select-segment',segment.value?.segment_code));
function advance(delta) { if (paused.value || props.guidancePaused || confirmEnd.value || !props.selectedRoute || restClosed.value) return; discardManualUndo(); if (delta === 1 && index.value < segments.value.length-1) markManualSegment(); index.value=Math.max(0,Math.min(segments.value.length-1,index.value+delta)); requestCamera(following.value ? 'follow' : 'current'); emit('select-segment',segment.value?.segment_code); }
function toggleVoice() { if (aheadBlocked.value || !props.selectedRoute) { stop(); return; } if (voiceEnabled.value) { voiceEnabled.value=false; stop(); } else { voiceEnabled.value=speak(instruction.value); } }
function replay() { if (!aheadBlocked.value && props.selectedRoute) speak(instruction.value); }
function stopLocation() { locationEnabled.value=false; clearLocation?.(); clearLocation=null; clearInterval(staleTimer); position.value=null; quality.value='waiting'; streak=0; offRoute.value=false; lastTimestamp=0; }
function toggleLocation() {
  if (props.guidancePaused) return;
  if (locationEnabled.value) { stopLocation(); return; }
  locationEnabled.value=true; locationError.value=''; quality.value='waiting'; requestCamera('follow');
  clearLocation=watchCoordinates(sample => {
    if (props.guidancePaused || !locationEnabled.value) return;
    if (!Number.isFinite(sample.longitude) || !Number.isFinite(sample.latitude) || Math.abs(sample.longitude)>180 || Math.abs(sample.latitude)>90 || !Number.isFinite(sample.timestamp) || sample.timestamp > Date.now()+5000 || sample.timestamp <= lastTimestamp) { quality.value='stale'; if (props.detourActive) emit('pause-detour', '位置无效或重复，绕行引导暂停，请重新定位。'); return; }
    lastTimestamp=sample.timestamp; const point=wgs84ToGcj02(sample.longitude,sample.latitude); position.value={...sample,point};
    const result=evaluatePosition(position.value,routePaths.value,streak); streak=result.streak; quality.value=result.quality;
    if (props.detourActive && result.quality !== 'good') { emit('pause-detour', '位置质量不足，绕行引导暂停，请重新定位。'); return; }
    const newlyOff=result.offRoute && !offRoute.value; offRoute.value=result.offRoute;
    if (props.detourActive && newlyOff) { emit('pause-detour', '可能偏离绕行路线，已暂停，请在安全处重新定位。'); return; }
    if (newlyOff && voiceEnabled.value && !aheadBlocked.value) speak(locationMessage.value);
  }, error => { locationError.value=error.message; stopLocation(); if (props.detourActive) emit('pause-detour', '定位不可用，绕行引导已暂停，请重试。'); });
  if (!locationEnabled.value) { clearLocation?.(); clearLocation=null; return; }
  staleTimer=setInterval(() => { if (position.value && Date.now()-position.value.timestamp>15000) { quality.value='stale'; streak=0; offRoute.value=false; if (props.detourActive) emit('pause-detour', '位置已过期，绕行引导暂停，请重新定位。'); } },3000);
}
onBeforeUnmount(() => { restClosed.value=true; stop(); stopLocation(); });
</script>
<template>
  <section v-if="guidancePaused" class="journey-alert journey-paused" role="alert">
    <h1>绕行引导已暂停</h1><p>请停在安全处，通过绕行面板重新定位、确认路段和新路线。不会恢复旧语音或旧地图引导。</p>
    <button type="button" @click="$emit('open-routes')">返回路线页</button>
    <button type="button" @click="$emit('request-detour-end', $event)">结束本次行程</button>
    <button type="button" :disabled="sosSubmitting" @click="$emit('send-sos')">紧急求助</button>
  </section>
  <section v-else @click.capture="discardUndoOnOtherAction" @change.capture="discardManualUndo" class="navigation-page journey-page" :class="{ 'journey-large-text': largeText && !largeTextBlocked }">
    <aside class="navigation-side-panel journey-panel">
      <div class="journey-heading"><div><p class="section-kicker">{{ paused ? '在安全处歇一歇' : '一步一步，安心前行' }}</p><h1>{{ showMap ? '逐段地图导航' : '逐段文字导航' }}</h1></div><button class="journey-sos" type="button" :disabled="sosSubmitting" @click="$emit('send-sos')">{{ sosSubmitting ? '求助中…' : '紧急求助' }}</button></div>
      <section v-if="paused" class="journey-rest-panel" data-testid="navigation-paused" aria-labelledby="navigation-paused-title">
        <h2 id="navigation-paused-title">已暂停，安心歇一歇</h2>
        <p role="status">已暂停播报和路段推进，位置跟随也已暂停。</p>
        <p class="journey-rest-step">手动进度停在第 {{ index+1 }} 段，共 {{ segments.length }} 段：{{ segment?.name || '资料未确认' }}</p>
        <p>这是在您选择的安全位置休息，不表示已到登记休息点；定位不会确认到达。休息好后仍从这一段继续。</p>
        <button class="journey-primary" type="button" :disabled="!segment" @click="resumeNavigation">继续前行</button>
        <button v-if="pausedRestAvailable" type="button" :aria-expanded="pausedRestOpen" aria-controls="paused-rest-preview" @click="togglePausedRestPreview">{{ pausedRestOpen ? '收起前方休息信息' : '看看前方能在哪歇' }}</button>
        <section v-if="pausedRestPreview" id="paused-rest-preview" class="journey-paused-rest-preview" data-testid="paused-rest-preview" :data-state="pausedRestPreview.hint.state" aria-labelledby="paused-rest-preview-title">
          <h3 id="paused-rest-preview-title">前方登记休息点（只读）</h3>
          <p>{{ pausedRestPreview.hint.text }}</p>
          <p v-if="pausedRestPreview.hint.state === 'upcoming'">包含尚未手动确认走完的当前整段；不是您所在位置的实际距离。</p>
          <p v-if="pausedRestPreview.plan">沿用本页已选计划：{{ walkingPlan }} 米。{{ pausedRestPreview.plan.text }}</p>
          <p v-if="pausedRestPreview.hint.destinationText">{{ pausedRestPreview.hint.destinationText }}</p>
          <p v-if="pausedRestPreview.hint.state !== 'unknown'">只依据登记路线，不保证有座位或现场通行，也不确认到达。</p>
        </section>
      </section>
      <button v-else class="journey-rest-action" type="button" :disabled="!segment" @click="pauseNavigation">累了，休息一下</button>
      <button v-if="manualRecoveryAvailable" ref="manualRecoveryButton" class="journey-manual-recovery-trigger" type="button"
        data-testid="navigation-manual-recovery-trigger" :aria-expanded="manualRecoveryOpen" aria-controls="navigation-recovery"
        @click="openManualRecovery">我不确定走到哪</button>
      <section class="journey-wake-lock" data-testid="navigation-wake-lock" aria-label="导航时保持屏幕亮">
        <button v-if="['active', 'pending', 'release-error'].includes(wakeState)" type="button" @click="wakeLock.disable">{{ wakeState === 'pending' ? '取消常亮申请' : wakeState === 'release-error' ? '重试关闭屏幕常亮' : '关闭屏幕常亮' }}</button>
        <button v-else type="button" :disabled="aheadBlocked || wakeBusy || !wakeLock.supported || wakeState === 'release-error'" @click="wakeLock.enable">导航时保持屏幕亮</button>
        <p role="status" aria-live="polite">{{ wakeMessage }}</p>
        <p>需浏览器和设备支持；休息、离开或切到后台后需再次点击开启。</p>
      </section>
      <section v-if="recoveryVisible" ref="recoveryCard" id="navigation-recovery" class="journey-recovery" data-testid="navigation-recovery"
        tabindex="-1" aria-labelledby="navigation-recovery-title" @keydown.esc="closeManualRecoveryOnEscape">
        <h2 id="navigation-recovery-title">核对我走到哪</h2>
        <p v-if="recoveryIssue">{{ recoveryIssue }}</p>
        <p>手动进度仍在第 {{ index+1 }} 段：{{ segment?.name }}。以下操作只帮助核对登记信息，不能确定您实际站在哪里；请与现场核对后再继续。</p>
        <div class="journey-recovery-actions">
          <button type="button" :disabled="!currentGeometry" @click="recoverNavigation('map')">查看本段登记地图</button>
          <button type="button" @click="recoverNavigation('text')">按本段文字继续</button>
        </div>
        <p v-if="!currentGeometry">本段登记图形缺失或无效，请使用本段文字核对。</p>
        <button v-if="manualRecoveryOpen" type="button" data-testid="navigation-manual-recovery-close" @click="closeManualRecovery">关闭核对</button>
      </section>
      <div class="journey-ahead-tools">
        <button type="button" :disabled="aheadBlocked" @click="hearAhead">听前方情况</button>
        <button v-if="playing" type="button" @click="stop">停止播报</button>
        <p v-if="summaryRequested">仅播报这一次，不开启自动语音。</p>
        <p v-if="summaryError && !aheadBlocked" role="status">{{ summaryError }}</p>
        <p v-if="summaryRequested && !aheadBlocked" data-testid="navigation-ahead-summary">{{ aheadSummary }}</p>
      </div>
      <p v-if="stairHint.state === 'none' || stairHint.state === 'unknown'" class="journey-stair-fact" data-testid="navigation-stairs" :data-state="stairHint.state">{{ stairHint.text }}</p>
      <details v-else-if="stairHint.state === 'ahead' || stairHint.state === 'current'" class="journey-stairs" data-testid="navigation-stairs" :data-state="stairHint.state" aria-labelledby="navigation-stairs-title">
        <summary>
          <strong id="navigation-stairs-title">前方登记台阶：</strong>
          <span v-if="stairHint.state === 'ahead'">第 {{ stairHint.index + 1 }} 段有 {{ stairHint.count }} 级</span>
          <span v-else-if="stairHint.state === 'current'">本段 {{ stairHint.count }} 级</span>
          <span v-else>资料未确认</span>
        </summary>
        <div class="journey-stair-details">
        <p class="journey-stair-fact">{{ stairHint.text }}</p>
        <template v-if="stairHint.state === 'ahead' || stairHint.state === 'current'">
          <p v-if="stairHint.state === 'ahead' && stairHint.distance != null">估算包含尚未手动确认走完的当前整段；仅到该段起点，不是到台阶的实际距离。</p>
          <p>台阶具体位置未确认，请与现场核对。</p>
          <button type="button" :disabled="aheadBlocked || !stairGeometry" @click="inspectStairSegment">查看台阶所在登记路段</button>
          <p v-if="!stairGeometry">该段登记图形缺失、无效或有歧义，仍可核对以上文字。</p>
        </template>
        </div>
      </details>
      <div class="journey-mode-switch" role="group" aria-label="导航显示方式">
        <button type="button" :aria-pressed="showMap" aria-controls="optional-navigation-map" @click="showMap=true">地图导航</button>
        <button type="button" :aria-pressed="!showMap" @click="showMap=false">文字导航</button>
      </div>
      <button class="journey-text-size" type="button" :aria-pressed="largeText && !largeTextBlocked" :disabled="largeTextBlocked" @click="toggleLargeText">{{ largeText ? '关闭导航文字放大' : '放大导航文字' }}</button>
      <p class="journey-counter" :aria-live="voiceEnabled ? 'off' : 'polite'" aria-atomic="true">{{ segments.length ? `第 ${index+1} 段，共 ${segments.length} 段：${segment?.name || '资料未确认'}` : '暂无路段，请返回路线页' }}<span class="journey-announcement">{{ segmentText.steps }} {{ segmentText.width }}<template v-if="segment?.risk_tags?.length">登记注意事项：{{ [...new Set(segment.risk_tags)].join('、') }}</template></span></p>
      <p v-if="arrivalSession && !detourActive" data-testid="manual-confirmed-count">当前正在走第 {{ index + 1 }} 段；手动标记确认了 {{ manualConfirmedCount }} 段 / 共 {{ segments.length }} 段。仅记录手动选择。</p>
      <div class="journey-progress"><button type="button" :disabled="index <= 0 || paused" @click="advance(-1)">上一段</button><button ref="manualConfirmButton" data-manual-confirmation="true" class="journey-primary" type="button" :disabled="!segment || paused" @click="index < segments.length-1 ? advance(1) : openEnd($event)">{{ index < segments.length-1 ? '已走完这段' : '核对目的地并结束' }}</button></div>
      <button v-if="arrivalSession && !detourActive && index === segments.length-1" data-manual-confirmation="true" type="button" :disabled="paused || confirmEnd || restClosed" @click="markManualSegment">手动确认最后一段已走完</button>
      <div class="journey-manual-undo">
        <div v-for="action in manualUndoActions" data-testid="navigation-manual-undo">
          <button data-manual-confirmation="true" type="button" @click="action.undo">撤销刚才的确认</button>
          <p>仅撤回刚才新增的一次标记；回看请用“上一段”。</p>
        </div>
        <p v-if="arrivalSession && !detourActive">重复确认已标记的路段不提供撤销；回看请用“上一段”。</p>
        <p v-if="manualUndoStatus" role="status" aria-live="polite">{{ manualUndoStatus }}</p>
      </div>
      <section class="journey-memo" aria-label="保存文字路线（只读）">
        <button type="button" :disabled="memoBlocked || !memoManifest.available" :aria-expanded="Boolean(memoText)"
          aria-controls="navigation-route-memo" aria-describedby="navigation-memo-disclosure" @click="toggleMemo">{{ memoText ? '收起路线备忘' : '保存文字路线' }}</button>
        <p id="navigation-memo-disclosure">先查看只读文字；仅在另按下载按钮后请求浏览器下载。不提供离线导航、断网重载或手机系统文件保存保证。</p>
        <p v-if="!memoManifest.available" role="status">{{ memoUnavailableReason }}</p>
        <section v-if="memoText && memoManifest.available && !memoBlocked" id="navigation-route-memo" data-testid="navigation-memo-preview" aria-labelledby="navigation-memo-title">
          <h2 id="navigation-memo-title">路线备忘（只读）</h2>
          <p>与上方实时引导分开：这是当前所选路线的完整登记清单，不随定位更新。本页关闭、刷新或切换行程后不保留。</p>
          <pre data-testid="navigation-memo-text" tabindex="0" aria-label="可选择的路线备忘文字">{{ memoText }}</pre>
          <p>可长按或用鼠标、键盘直接选择上方文字，自行复制；无需授予剪贴板权限。</p>
          <button v-if="memoDownloadSupported" type="button" @click="downloadMemo">下载文字路线（浏览器）</button>
          <p v-else role="status">此浏览器或应用内页面不支持此下载方式；请直接选择上方文字。</p>
          <p v-if="memoStatus" role="status">{{ memoStatus }}</p>
        </section>
      </section>
      <div class="journey-position-actions" role="group" aria-label="定位快捷操作">
        <button type="button" :aria-pressed="locationEnabled" @click="toggleLocation">{{ locationEnabled ? '关闭定位' : '开启我的位置' }}</button>
        <button v-if="showMap" type="button" aria-label="回到当前位置并跟随" :disabled="!mapPosition" @click="resumeFollow">回到我</button>
      </div>
      <section v-if="showMap" id="optional-navigation-map" class="navigation-map-panel journey-map" aria-label="当前规划路线地图">
        <AmapRouteMap v-if="pilotArea && !mapFailure" active-navigation :rest-waypoint="restWaypoint" :ordered-segment-codes="selectedRoute?.segment_codes || []" :manual-index="index" :following="following" :camera-request="cameraRequest" :current-segment-code="segment?.segment_code" :area="pilotArea" :features="navigationFeatures" :route-segment-codes="routeSegmentCodes" :selected-segment-code="mapSelectedCode" :position="mapPosition" @browse="browseMap" @select-segment="inspectSegment" @map-error="$emit('map-error',$event)" />
        <div v-else><p class="map-fallback-notice"><span>{{ mapFailure ? '底图暂不可用，使用登记路网示意' : '正在准备地图，使用登记路网示意' }}</span><button type="button" :disabled="mapRetrying" @click="$emit('retry-map')">重试底图</button></p><FallbackRouteMap active-navigation :rest-waypoint="restWaypoint" :ordered-segment-codes="selectedRoute?.segment_codes || []" :manual-index="index" :features="navigationFeatures" :route-segment-codes="routeSegmentCodes" :selected-segment-code="mapSelectedCode" :position="mapPosition" @select-segment="inspectSegment" /></div>
        <ul class="journey-map-legend" aria-label="路线进度图例">
          <li><span class="legend-completed" aria-hidden="true"></span>短虚线：已手动确认完成</li>
          <li><span class="legend-current" aria-hidden="true"></span>粗实线及“当前”标记：当前第 {{ index+1 }} 段</li>
          <li><span class="legend-upcoming" aria-hidden="true"></span>长虚线：尚未确认完成</li>
          <li>橙色细线及“查看”标记：临时查看，不改变进度</li>
          <li v-if="restWaypoint">紫色菱形“休”：下一登记休息点的路网节点，非座椅位置</li>
        </ul>
        <div class="journey-map-controls" aria-label="地图视角控制">
          <p data-testid="map-follow-state" role="status">{{ followMessage }}</p>
          <p class="journey-location" role="status">{{ locationMessage }}</p>
          <button type="button" :disabled="!currentGeometry" @click="requestCamera('current')">查看当前路段</button>
          <button type="button" @click="requestCamera('overview')">查看全程</button>
          <button type="button" :disabled="!nextSegment" :aria-expanded="previewNext" aria-controls="next-segment-preview" @click="previewNextSegment">预览下一段</button>
          <p v-if="!currentGeometry">当前路段缺少支持的登记图形，无法居中高亮；请使用文字指引和手动进度。</p>
          <p v-if="!nextSegment">已是最后一段，没有下一登记路段；请现场核对目的地后结束。</p>
        </div>
        <section v-if="previewNext && nextSegment" id="next-segment-preview" class="journey-preview" aria-labelledby="next-segment-title">
          <h2 id="next-segment-title">下一登记路段：{{ nextSegment.name }}</h2>
          <p>仅预览，当前仍为第 {{ index+1 }} 段：{{ segment?.name }}；不表示已走完或可以通行。</p>
          <p>{{ nextSegmentText.steps }}</p><p>{{ nextSegmentText.width }}</p>
          <p>{{ nextSegment.risk_tags?.length ? `登记注意事项：${[...new Set(nextSegment.risk_tags)].join('、')}` : '其他风险未记录，不代表没有障碍。' }}</p>
          <p v-if="nextSegment.explanation">登记辅助说明：{{ nextSegment.explanation }}</p>
          <p v-if="!nextGeometry">下一段缺少支持的登记图形：仅显示登记文字，无法居中或高亮。</p>
          <p>不从路网图形推断转弯方向或入口；请核对现场。</p>
          <button type="button" @click="requestCamera('current')">返回当前路段</button>
          <button type="button" :disabled="!mapPosition" @click="resumeFollow">返回位置跟随</button>
        </section>
      </section>
      <p class="journey-estimate">按{{ selectedProfile?.label || '当前出行情况' }}安排；路段推进由您手动确认，不会自动判断已走完或已到达。</p>
      <p class="journey-estimate" data-testid="manual-remaining">{{ displayedRemaining === null ? '登记剩余路程暂未确认：路段长度缺失、不完整或与全程不一致。' : `按手动确认进度估算，登记剩余约 ${displayedRemaining} 米。` }}包含尚未确认走完的当前整段，不是当前位置到终点的精确距离。</p>
      <p v-if="arrivalBoundaryText(selectedRoute)" class="journey-location" aria-label="导航到达边界">{{ arrivalBoundaryText(selectedRoute) }}</p>
      <section class="journey-current" aria-labelledby="current-segment-title">
        <h2 id="current-segment-title">{{ segment?.name || '请先返回路线方案' }}</h2>
        <div class="journey-show-step" @keydown.esc="closeShowStepOnEscape">
          <button ref="showStepButton" class="journey-primary" type="button" :disabled="showStepBlocked"
            :aria-expanded="showStepOpen" aria-controls="navigation-show-step"
            :aria-describedby="showStepBlocked ? 'navigation-show-step-reason' : undefined" @click="openShowStep">给身边的人看</button>
          <p v-if="showStepBlocked" id="navigation-show-step-reason" role="status">{{ showStepReason }}</p>
          <section v-if="showStepOpen && !showStepBlocked" ref="showStepCard" id="navigation-show-step" data-testid="navigation-show-step"
            role="region" tabindex="-1" aria-labelledby="navigation-show-step-title" aria-describedby="navigation-show-step-text navigation-show-step-caveat">
            <h3 id="navigation-show-step-title">请帮我核对这段路</h3>
            <p id="navigation-show-step-text" data-testid="navigation-show-step-text">第 {{ index+1 }} 段：{{ segment.name }}</p>
            <p id="navigation-show-step-caveat">这是我在查看的路线步骤，不能确认我就在这里。</p>
            <button type="button" @click="closeShowStep">关闭大字卡</button>
          </section>
        </div>
        <div class="journey-current-brief">
          <button class="journey-primary" type="button" :disabled="briefBlocked" :aria-expanded="Boolean(briefText)"
            aria-controls="navigation-current-brief" @click="hearCurrentBrief">慢一点，只听这一段</button>
          <section v-if="briefText && !briefBlocked" id="navigation-current-brief" data-testid="navigation-current-brief" aria-label="这一段简述">
            <p data-testid="navigation-current-brief-text">{{ briefText }}</p>
            <button v-if="briefSpeaking" type="button" @click="stop">停止这一段播报</button>
            <p v-if="voiceError" role="status">{{ voiceError }}</p>
            <p>仅慢速播报这一次，不会自动重复。</p>
          </section>
          <p v-if="!currentStepBrief">当前路段资料未确认，暂不能简述；请先核对路线。</p>
        </div>
        <h3>现在怎么做</h3>
        <p v-if="segment" class="journey-action-sentence">先核对本段登记信息与现场。确认可继续时沿本段前行；走完后再用进度按钮确认，不猜测转弯或入口。</p>
        <p v-if="segment?.explanation">登记辅助说明：{{ segment.explanation }}</p>
        <p class="journey-hazard">{{ segmentText.steps }}</p><p>{{ segmentText.width }}</p>
        <p>登记资料不保证现场通行；缺记录不等于没有障碍。</p>
        <div class="journey-photo-cue">
          <button ref="cueButton" class="journey-primary" type="button" :disabled="!cueManifest.available || cueBlocked"
            :aria-expanded="cueOpen" aria-controls="navigation-photo-cue" aria-describedby="photo-cue-availability"
            @click="toggleCue">看实景认路</button>
          <p id="photo-cue-availability">{{ cueUnavailableReason || '按手动步骤核对登记照片；展开后才请求一张照片。' }}</p>
          <section v-if="cueOpen && cueStep" id="navigation-photo-cue" data-testid="navigation-photo-cue"
            role="region" aria-label="登记实景认路" @keydown.esc.stop="closeCue">
            <button ref="cueCloseButton" type="button" @click="closeCue">关闭实景</button>
            <p>{{ PHOTO_CUE_CAVEAT }}</p>
            <p>不是实时定位或通行建议；照片出现不表示应向那里行走。</p>
            <div v-if="cueManifest.steps.length > 1" class="journey-photo-cue-controls" aria-label="选择路线步骤">
              <button v-for="(step, i) in cueManifest.steps" :key="step.segmentCode" type="button"
                :aria-pressed="cueStepIndex === i" @click="selectCueStep(i)">{{ step.kind === 'current' ? '当前段实景' : '下一段实景' }}</button>
            </div>
            <h3 data-testid="navigation-photo-cue-step">{{ cueStep.kind === 'current' ? '当前段' : '下一段' }} · 第 {{ cueStep.index + 1 }} 段：{{ cueStep.name }}</h3>
            <p>按手动确认进度列出，不代表您所在的道路。</p>
            <figure v-if="cuePhoto">
              <img v-if="!cueFailed" ref="cueImage" :key="`${cueStep.index}:${cuePhotoIndex}:${cuePhoto.url}`"
                data-testid="navigation-photo-cue-image" :src="cuePhoto.url" :alt="cuePhoto.caption"
                referrerpolicy="no-referrer" @error="markCueFailed" />
              <figcaption data-testid="navigation-photo-cue-caption">{{ cuePhoto.caption }}</figcaption>
            </figure>
            <p v-if="cueFailed" role="status">照片加载失败或网络不可用；仍可核对照片说明与本段文字指引。不会自动重试。</p>
            <p v-if="!cuePhoto">{{ cueStep.reason || '本段暂无可核对的登记实景照片，请使用本段文字指引。' }}</p>
            <div v-if="cueStep.photos.length > 1" class="journey-photo-cue-controls">
              <button type="button" :disabled="cuePhotoIndex === 0" @click="moveCuePhoto(-1)">上一张</button>
              <button type="button" :disabled="cuePhotoIndex >= cueStep.photos.length - 1" @click="moveCuePhoto(1)">下一张</button>
              <p>第 {{ cuePhotoIndex + 1 }} / {{ cueStep.photos.length }} 张</p>
            </div>
          </section>
        </div>
        <div class="journey-obstruction">
          <button ref="obstructionButton" type="button" :disabled="!obstructionState.options.length || detourActive"
            :aria-expanded="Boolean(obstructionDraft)" aria-controls="navigation-obstruction"
            aria-describedby="obstruction-availability" @click="openObstruction">前方走不了</button>
          <p id="obstruction-availability">{{ obstructionState.reason || '仅可选择当前或下一登记路线步骤；不根据定位判断您在哪一段。' }}</p>
          <section v-if="obstructionDraft" id="navigation-obstruction" aria-labelledby="obstruction-title" @keydown.esc="cancelObstruction">
            <h3 id="obstruction-title" ref="obstructionHeading" tabindex="-1">哪一段走不了？</h3>
            <p>以下按您手动确认的路线进度列出，不是 GPS 所在道路，也不是地图临时查看的路段。请先核对现场。</p>
            <fieldset><legend>选择要绕开的登记路线步骤</legend>
              <label v-for="option in obstructionDraft" :key="option.index">
                <input v-model="obstructionChoice" type="radio" name="obstruction-step" :value="option" />
                <span>{{ option.kind === 'current' ? '当前路线步骤' : '下一路线步骤' }} · 第 {{ option.index + 1 }} 段：{{ option.name }}（编号 {{ option.segment_code }}）</span>
              </label>
            </fieldset>
            <p v-if="obstructionChoice" role="status">将绕开第 {{ obstructionChoice.index + 1 }} 段“{{ obstructionChoice.name }}”。确认后旧地图、语音、位置跟随与手动下一段引导全部暂停；需另按定位按钮、确认道路并使用新路线。</p>
            <button type="button" :disabled="!obstructionChoice" @click="confirmObstruction">绕开这段，暂停导航</button>
            <button type="button" @click="cancelObstruction">取消，继续原行程</button>
          </section>
        </div>
        <p v-if="segment?.risk_tags?.length" class="journey-hazard">登记注意事项：{{ [...new Set(segment.risk_tags)].join('、') }}</p>
        <section v-if="restHint.state !== 'hidden'" data-testid="navigation-rest" :data-state="restHint.state" aria-labelledby="navigation-rest-title">
          <h3 id="navigation-rest-title">前方登记休息点</h3>
          <p data-testid="navigation-rest-message">{{ restHint.text }}</p>
          <button v-if="restWaypoint" type="button" aria-controls="optional-navigation-map" @click="inspectRestWaypoint">在地图查看休息点</button>
          <p v-if="restWaypoint">地图“休”标记是休息点关联的登记路网节点，不是座椅位置；座位是否可用、是否实时到达均未确认。</p>
          <p v-if="restHint.state === 'upcoming'">包含尚未确认走完的当前整段；不是实时定位点距，未自动判断已到休息点。</p>
          <div v-if="restHint.state === 'upcoming'" class="journey-rest-plan">
            <label for="navigation-walking-plan">我计划再走的距离（可选）</label>
            <select id="navigation-walking-plan" :value="walkingPlan ?? ''" aria-describedby="navigation-plan-explanation" @change="changeWalkingPlan">
              <option value="">暂不设置</option>
              <option v-for="budget in WALKING_BUDGETS" :key="budget" :value="budget">{{ budget }} 米</option>
            </select>
            <p id="navigation-plan-explanation">仅比较到下一登记中途休息点的估算，包含尚未手动确认走完的当前整段；不同于出发前的不间断步行预算，也不是实际距离。选择仅在本页临时使用，不保存或发送。</p>
            <p v-if="restPlan" data-testid="navigation-rest-plan" :data-state="restPlan.state">{{ restPlan.text }}</p>
          </div>
          <p v-if="restHint.destinationText" data-testid="navigation-rest-destination">{{ restHint.destinationText }}</p>
          <p>只依据本条有向路线与登记关联节点，不保证有座位或现场通行。</p>
        </section>
      </section>
      <div class="journey-tools"><button type="button" :disabled="!segment || paused" :aria-pressed="voiceEnabled" @click="toggleVoice">{{ voiceEnabled ? '关闭语音' : '开启语音提示' }}</button><button type="button" :disabled="!segment || paused" @click="replay">{{ playing ? '重新播报' : '重播本段' }}</button></div>
      <p v-if="voiceError && !briefText" class="journey-alert" role="alert">{{ voiceError }}</p><p class="journey-location" :class="{ 'journey-alert': offRoute }" role="status">{{ locationMessage }}</p>
      
      <details class="journey-directions"><summary>查看全程 {{ segments.length }} 段指引</summary><ol><li v-for="(item,i) in segments" :key="i" :aria-current="i===index ? 'step' : undefined"><strong>{{ i+1 }}. {{ item.name }}（{{ routePartLabel(routePartState(item.segment_code,selectedRoute?.segment_codes || [],index)) }}）</strong><p>{{ buildSegmentInstruction(item,i,segments.length) }}</p></li></ol></details>
      <div class="journey-exit"><button type="button" @click="leaveRoutes">查看路线方案</button><button type="button" @click="openEnd">结束导航</button></div>
    </aside>
    <div v-if="confirmEnd" class="journey-dialog-backdrop">
      <!-- Bind the handlers to this rendered request; cached wrappers must not
           dereference a later dialog's choices after a session change. -->
      <section v-for="actions in [endActions]" :ref="element => endDialog = element"
        role="dialog" aria-modal="true" aria-labelledby="end-title" aria-describedby="end-description"
        class="journey-dialog" @keydown="trapDialog" @keydown.esc.stop.prevent="actions.dismiss">
        <h2 id="end-title">确认结束这次导航？</h2>
        <p id="end-description">请现场确认是否到达目的地。结束导航不会自动验证到达。</p>
        <p v-if="arrivalBoundaryText(selectedRoute)">{{ arrivalBoundaryText(selectedRoute) }}</p>
        <button type="button" autofocus @click="actions.dismiss">继续导航</button>
        <template v-if="!detourActive">
          <button type="button" @click="actions.arrived">我已到达（本人确认）</button>
          <button type="button" @click="actions.unconfirmed">结束但未确认到达</button>
        </template>
        <button v-else type="button" @click="actions.legacy">确认结束导航</button>
        <button v-if="!detourActive" type="button" aria-label="关闭结束确认" @click="actions.dismiss">关闭</button>
      </section>
    </div>
  </section>
</template>
<style>
/* The legacy shell has a 320px minimum. Relax it only while active guidance is mounted. */
html:has(.journey-page), body:has(.journey-page),
html:has(.journey-paused), body:has(.journey-paused) { min-width:0; }
</style>
<style scoped>
.journey-page { gap:16px; font-size: 1.25rem; line-height: 1.7; min-width: 0; grid-template-columns: minmax(0, 1fr); }
.journey-panel { padding:22px; display:block; min-width: 0; max-width: 100%; overflow: visible; overflow-wrap: anywhere; }
.journey-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; position:static; }
.journey-heading h1 { margin:8px 0; font-size:1.75rem; letter-spacing:normal; }
.journey-counter { border-radius:16px; background:#e5eee6; padding:8px 12px; color:#225441; white-space:normal; font-weight:700; font-size:1.125rem; }
.journey-manual-undo { margin:12px 0; min-width:0; overflow-wrap:anywhere; }
.journey-manual-undo button { width:100%; min-height:48px; white-space:normal; }
.journey-manual-undo :focus-visible { outline:3px solid #245d47; outline-offset:3px; }
.journey-mode-switch { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; margin:12px 0; }
.journey-mode-switch [aria-pressed="true"] { background:#245d47; color:white; border-color:#245d47; box-shadow:inset 0 -4px 0 #c2dfcd; }
.journey-estimate { margin:4px 0 18px; font-size:1.125rem; color:#52685a; }
.journey-current { padding:18px; background:#edf5ee; border:1px solid #c7dcca; border-radius:18px; }
.journey-current h2 { font-size:1.75rem; margin:6px 0 10px; overflow-wrap:anywhere; }
.journey-show-step { margin:12px 0; min-width:0; overflow-wrap:anywhere; }
.journey-show-step button { width:100%; min-width:48px; min-height:48px; }
.journey-show-step section { margin-top:12px; padding:12px; border:2px solid #245d47; border-radius:12px; background:#fff; min-width:0; }
.journey-current .journey-show-step h3 { margin:0 0 12px; font-size:1.5rem; }
.journey-show-step [data-testid="navigation-show-step-text"] { font-size:1.75rem; font-weight:750; line-height:1.7; }
.journey-show-step section p { font-size:1.375rem; }
.journey-show-step section > button { margin-top:14px; }
.journey-show-step :focus-visible, .journey-show-step section:focus { outline:3px solid #245d47; outline-offset:3px; }
.journey-current-brief { margin:12px 0; min-width:0; }
.journey-current-brief button { width:100%; min-width:48px; min-height:48px; }
.journey-current-brief section { margin-top:10px; padding:12px; border:2px solid #245d47; border-radius:12px; background:#fff; }
.journey-current-brief section > button { margin:10px 0; }
.journey-current-brief [data-testid="navigation-current-brief-text"] { font-size:1.375rem; font-weight:700; line-height:1.8; }
.journey-memo { margin:12px 0; min-width:0; font-size:1.125rem; }
.journey-memo button { width:100%; min-width:48px; min-height:48px; }
.journey-memo p { margin:8px 0; }
.journey-memo section { padding:12px; border:2px solid #245d47; border-radius:12px; background:#fff; min-width:0; }
.journey-memo h2 { font-size:1.375rem; margin:0 0 8px; }
.journey-memo pre { white-space:pre-wrap; overflow-wrap:anywhere; word-break:normal; min-width:0; max-width:100%; margin:12px 0; font:inherit; font-size:1.375rem; line-height:1.8; user-select:text; -webkit-user-select:text; cursor:text; }
.journey-memo pre:focus-visible { outline:3px solid #245d47; outline-offset:3px; }
.journey-current h3 { font-size:1.25rem; margin:.75em 0 .25em; }
.journey-current p { line-height:1.85; margin:0; }
.journey-action-sentence { font-size:1.25rem; }
.journey-current p + p { margin-top:.75em; }
.journey-current .journey-hazard { color:#915127; font-size:1.125rem; }
.journey-photo-cue { margin:14px 0; min-width:0; font-size:1.125rem; overflow-wrap:anywhere; }
.journey-photo-cue button { width:100%; min-width:48px; min-height:48px; font:inherit; }
.journey-photo-cue section { margin-top:12px; padding:12px; border:2px solid #245d47; border-radius:12px; background:#fff; min-width:0; }
.journey-photo-cue section > button { margin-bottom:12px; }
.journey-photo-cue figure { margin:12px 0; min-width:0; }
.journey-photo-cue img { display:block; width:100%; height:auto; max-height:50vh; object-fit:contain; }
.journey-photo-cue figcaption { margin-top:8px; font-weight:700; line-height:1.8; }
.journey-photo-cue-controls { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
.journey-photo-cue-controls > button { flex:1 1 120px; width:auto; }
.journey-photo-cue-controls > p { flex-basis:100%; }
.journey-photo-cue [aria-pressed="true"] { background:#245d47; color:#fff; }
.journey-photo-cue :focus-visible { outline:3px solid #245d47; outline-offset:3px; }
.journey-obstruction { margin:14px 0; padding-top:12px; border-top:2px solid #805425; }
.journey-obstruction > button { width:100%; border:2px solid #805425; background:#fff1df; color:#68421d; }
.journey-obstruction p { font-size:1.125rem; }
.journey-obstruction fieldset { min-width:0; margin:12px 0; padding:10px; border:1px solid #805425; border-radius:12px; }
.journey-obstruction label { display:flex; align-items:center; gap:10px; min-height:48px; padding:8px 0; }
.journey-obstruction input { flex:0 0 auto; width:22px; height:22px; }
.journey-obstruction section > button { display:block; width:100%; margin-top:10px; }
.journey-obstruction :focus-visible { outline:3px solid currentColor; outline-offset:3px; }
.journey-rest-plan { margin:10px 0; min-width:0; }
.journey-wake-lock { margin:8px 0 12px; font-size:1.125rem; min-width:0; }
.journey-wake-lock button { width:100%; }
.journey-wake-lock p { margin:4px 0; overflow-wrap:anywhere; }
.journey-rest-plan label { display:block; }
.journey-rest-plan select { box-sizing:border-box; width:auto; max-width:100%; min-width:0; min-height:48px; margin:4px 0; padding:6px; font:inherit; color:inherit; background:#fff; border:1px solid #c9d6c9; border-radius:8px; }
.journey-rest-plan select:focus-visible { outline:3px solid currentColor; outline-offset:3px; }
.journey-progress,.journey-position-actions,.journey-tools { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin:14px 0; position:static; }
.journey-progress,.journey-position-actions { margin:0 0 8px; }
.journey-progress,.journey-position-actions { gap:8px; }
.journey-page button,.journey-paused button { min-height: 48px; border:1px solid #c9d6c9; border-radius:12px; color:#264d3b; background:#fff; font:inherit; font-size:1.125rem; font-weight:650; padding:10px 12px; white-space:normal; overflow-wrap:anywhere; max-width:100%; min-width:0; }
.journey-page .journey-progress button,.journey-page .journey-position-actions button { padding:6px 8px; line-height:1.25; }
.journey-position-actions > button:only-child { grid-column:1/-1; }
.journey-page button:disabled { opacity:.45; }
.journey-page .journey-primary { background:#245d47; color:white; border-color:#245d47; }
.journey-location { font-size:1.125rem; line-height:1.7; color:#526a59; background:#f4f7f2; padding:10px 12px; border-radius:12px; }
.journey-alert { color:#94451e; background:#fff1df; padding:10px; border-radius:10px; }
.journey-page .journey-rest-action { width:100%; margin:4px 0 12px; border:2px solid #805425; background:#fff1df; color:#68421d; }
.journey-rest-panel { margin:12px 0; padding:18px; border:3px solid #805425; border-radius:18px; background:#fff1df; color:#68421d; }
.journey-rest-panel h2 { margin:0 0 10px; font-size:1.75rem; }
.journey-rest-panel p { margin:8px 0; }
.journey-rest-step { font-weight:700; }
.journey-rest-panel button { width:100%; margin-top:10px; }
.journey-paused-rest-preview { margin-top:12px; padding-top:12px; border-top:2px solid currentColor; }
.journey-paused-rest-preview h3 { margin:0; font-size:1.25rem; }
.journey-recovery { margin:12px 0; padding:14px; border:2px solid #915127; border-left-width:6px; border-radius:12px; background:#fff7e9; color:#68421d; }
.journey-recovery h2 { margin:0 0 8px; font-size:1.5rem; }
.journey-recovery p { margin:8px 0; }
.journey-recovery-actions { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr)); gap:8px; }
.journey-page .journey-manual-recovery-trigger { width:100%; min-width:48px; min-height:48px; margin:0 0 12px; border:2px solid #245d47; background:#245d47; color:#fff; font-weight:750; }
.journey-recovery { min-width:0; overflow-wrap:anywhere; }
.journey-recovery button { min-width:48px; min-height:48px; }
.journey-recovery > button { width:100%; margin-top:12px; }
.journey-manual-recovery-trigger:focus-visible, .journey-recovery:focus, .journey-recovery button:focus-visible { outline:3px solid #245d47; outline-offset:3px; }
.journey-stairs { margin:8px 0; padding:4px 10px; border:3px solid #805018; border-left-width:8px; border-radius:14px; background:#fff3ce; color:#593910; }
.journey-stairs p { margin:8px 0; }
.journey-stair-fact { font-weight:750; }
.journey-stairs button { width:100%; }
.journey-ahead-tools { display:flex; flex-wrap:wrap; gap:8px; margin:4px 0 8px; }
.journey-ahead-tools > button { flex:1 1 12rem; }
.journey-stairs > summary { min-height:44px; padding:5px 0; cursor:pointer; overflow-wrap:anywhere; }
.journey-stairs > summary:focus-visible { outline:3px solid currentColor; outline-offset:2px; }
.journey-stair-details { padding:4px 0 8px; }
.journey-ahead-tools > p { flex-basis:100%; margin:0; font-size:1.125rem; }
.journey-directions { margin:14px 0; }
.journey-directions summary { cursor:pointer; padding:14px 0; min-height:48px; font-size:1.125rem; font-weight:650; }
.journey-directions ol { padding-left:22px; }
.journey-directions li { padding:10px 4px; line-height:1.7; }
.journey-directions p { margin:5px 0; color:#52685a; }
.journey-directions [aria-current] { color:#18563f; }
.journey-exit { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
.journey-page .journey-sos { color:#963e30; border-color:#e8c1b6; background:#fff1eb; max-width:100%; }
.journey-map { min-width:0; min-height:0; height:auto; border-radius:18px; overflow:visible; border:1px solid #d5e2d7; box-shadow:none; }
.journey-map :deep(.amap-route-map),.journey-map :deep(.campus-map) { width:100%; height:clamp(240px,40vh,420px); min-height:240px; border-radius:18px; }
.journey-map :deep(.amap-map-actions) { position:static; max-width:100%; padding:8px; gap:8px; }
.map-fallback-notice { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; font-size:1.125rem; padding:8px; margin:0; }
.journey-map :deep(.fallback-map-note) { font-size:1.125rem; }
.journey-map :deep(span.navigation-road-label) { display:block; background:#fffdf7; border:2px solid #176b57; border-radius:8px; padding:4px 8px; color:#173d2c; font-size:1rem; font-weight:700; white-space:normal; }
.journey-map-controls { display:flex; flex-wrap:wrap; gap:8px; padding:12px; }
.journey-map-controls p { flex-basis:100%; margin:0; }
.journey-map-legend { margin:0; padding:12px 12px 12px 30px; font-size:1.125rem; }
.journey-map-legend span { display:inline-block; width:2em; vertical-align:middle; margin-right:.5em; }
.legend-completed { border-top:3px dashed #607d73; }
.legend-current { border-top:7px solid #176b57; }
.legend-upcoming { border-top:3px dashed #477eab; }
.journey-preview { margin:12px; padding:14px; border:2px solid #c26413; border-radius:14px; background:#fff7e9; }
.journey-preview h2 { font-size:1.25rem; margin:0 0 8px; }
.journey-preview button { margin:4px; }
.journey-page button:focus-visible,.journey-directions summary:focus-visible,.journey-paused button:focus-visible { outline:3px solid currentColor; outline-offset:3px; }
.journey-announcement { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
.journey-dialog-backdrop { position:fixed; inset:0; background:#15291d88; z-index:3000; display:grid; place-items:center; padding:1rem; }
.journey-dialog { box-sizing:border-box; width:100%; max-width:30rem; max-height: calc(100dvh - 2rem); overflow:auto; overflow-wrap:anywhere; font-size:1.25rem; background:#fffdf7; padding:24px; border-radius:22px; box-shadow:0 20px 70px #0003; }
.journey-dialog h2 { margin-top:0; }
.journey-dialog p { line-height:1.8; }
.journey-dialog button { width:100%; margin-top:10px; }
.journey-paused { font-size:1.25rem; overflow-wrap:anywhere; }
@media(max-width:48rem) {
  .journey-page { display:block; padding:.75rem; background:#fffdf7; border-radius:22px; }
  .journey-panel { padding:0; }
  .journey-tools { grid-template-columns:minmax(0,1fr); }
  .journey-exit { display:grid; grid-template-columns:minmax(0,1fr); }
  .journey-heading h1,.journey-current h2 { font-size:1.5rem; }
}
.journey-page .journey-text-size { width:100%; margin:0 0 8px; min-width:48px; }
.journey-page .journey-text-size[aria-pressed="true"] { background:#245d47; color:#fff; border-color:#245d47; }
.journey-large-text .journey-current > h2 { font-size:2rem; }
.journey-large-text .journey-action-sentence,
.journey-large-text .journey-counter,
.journey-large-text .journey-rest-step { font-size:1.625rem; }
.journey-page.journey-large-text button { font-size:1.5rem; min-width:48px; min-height:48px; }
.journey-large-text .journey-progress,
.journey-large-text .journey-position-actions,
.journey-large-text .journey-mode-switch,
.journey-large-text .journey-tools { grid-template-columns:repeat(auto-fit,minmax(min(100%,10rem),1fr)); }
</style>
