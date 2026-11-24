import test from 'node:test';
import assert from 'node:assert/strict';
import { useSurveyRecords } from '../src/composables/useSurveyRecords.js';

function jsonResponse(payload, ok = true) {
  return { ok, json: async () => payload };
}

test('survey records request GCJ02 and preserves site filtering', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    return jsonResponse(url.includes('/sites') ? [] : { features: [] });
  };
  try {
    const workflow = useSurveyRecords({ apiBaseUrl: 'http://api.test' });
    workflow.selectedSiteCode.value = 'site-4';
    await workflow.loadRecords();
    assert.match(requests[0].url, /coordinate_system=GCJ02/);
    assert.match(requests[0].url, /site_code=site-4/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('location placement uses bearer auth and GCJ02 while keeping survey records read-only otherwise', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const feature = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [121.5, 31.2] },
    properties: { record_code: 'record/a', evidence_photos: [] },
  };
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (options.method === 'PATCH') return jsonResponse({ ok: true });
    return jsonResponse({ features: [feature] });
  };
  try {
    const workflow = useSurveyRecords({ apiBaseUrl: 'http://api.test', accessToken: () => 'admin-token' });
    await workflow.loadRecords();
    await workflow.saveLocation();
    const patch = requests.find(({ options }) => options.method === 'PATCH');
    assert.equal(patch.url, 'http://api.test/api/survey-records/record%2Fa/location');
    assert.equal(patch.options.headers.Authorization, 'Bearer admin-token');
    assert.deepEqual(JSON.parse(patch.options.body), {
      longitude: 121.5,
      latitude: 31.2,
      coordinate_system: 'GCJ02',
    });
    assert.match(workflow.message.value, /仍处于待核查状态/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const record = (code) => ({
  type: 'Feature', geometry: null,
  properties: { record_code: code, evidence_photos: [] },
});

test('a superseded response cannot replace the current records or loading state', async () => {
  const originalFetch = globalThis.fetch;
  const pending = [];
  globalThis.fetch = () => new Promise(resolve => pending.push(resolve));
  const workflow = useSurveyRecords({ apiBaseUrl: 'http://api.test' });
  try {
    const first = workflow.loadRecords();
    const second = workflow.loadRecords();
    pending[1](jsonResponse({ features: [record('new')] }));
    await second;
    pending[0](jsonResponse({ features: [record('old')] }));
    await first;
    assert.equal(workflow.selectedRecordCode.value, 'new');
    assert.equal(workflow.loading.value, false);
    assert.equal(workflow.errorMessage.value, '');
  } finally { workflow.dispose?.(); globalThis.fetch = originalFetch; }
});

test('network failure is actionable Chinese text and a reload recovers both requests', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const workflow = useSurveyRecords({ apiBaseUrl: 'http://api.test' });
  try {
    await workflow.loadRecords();
    assert.match(workflow.errorMessage.value, /连接|网络/);
    assert.doesNotMatch(workflow.errorMessage.value, /Failed to fetch/);
    globalThis.fetch = async url => jsonResponse(url.includes('/sites') ? [{ site_code: 'one' }] : { features: [record('restored')] });
    await workflow.reload();
    assert.equal(workflow.errorMessage.value, '');
    assert.equal(workflow.sites.value.length, 1);
    assert.equal(workflow.selectedRecordCode.value, 'restored');
  } finally { workflow.dispose?.(); globalThis.fetch = originalFetch; }
});

test('timeout releases loading even when the transport ignores abort', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => new Promise(() => {});
  const workflow = useSurveyRecords({ apiBaseUrl: 'http://api.test', requestTimeoutMs: 20 });
  try {
    await workflow.loadRecords();
    assert.equal(workflow.loading.value, false);
    assert.match(workflow.errorMessage.value, /超时/);
  } finally { workflow.dispose?.(); globalThis.fetch = originalFetch; }
});

test('filter changes invalidate old placement immediately and disposal blocks late data', async () => {
  const originalFetch = globalThis.fetch;
  let resolveRead;
  globalThis.fetch = async () => jsonResponse({ features: [record('first')] });
  const workflow = useSurveyRecords({ apiBaseUrl: 'http://api.test' });
  try {
    await workflow.loadRecords();
    workflow.pendingCoordinate.value = [106, 29];
    globalThis.fetch = () => new Promise(resolve => { resolveRead = resolve; });
    workflow.selectedSiteCode.value = 'next';
    assert.equal(workflow.selectedRecordCode.value, null);
    assert.equal(workflow.pendingCoordinate.value, null);
    workflow.dispose();
    resolveRead(jsonResponse({ features: [record('late')] }));
    await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(workflow.features.value, []);
  } finally { workflow.dispose?.(); globalThis.fetch = originalFetch; }
});

test('saving one record cannot move the new selection or its unsaved coordinate', async () => {
  const originalFetch = globalThis.fetch;
  let finishSave;
  globalThis.fetch = async (_url, options = {}) => options.method === 'PATCH'
    ? new Promise(resolve => { finishSave = resolve; })
    : jsonResponse({ features: [record('one'), record('two')] });
  const workflow = useSurveyRecords({ apiBaseUrl: 'http://api.test', accessToken: () => 'token' });
  try {
    await workflow.loadRecords();
    workflow.pendingCoordinate.value = [106, 29];
    const saving = workflow.saveLocation();
    workflow.selectRecord('two');
    workflow.pendingCoordinate.value = [107, 30];
    finishSave(jsonResponse({ geometry: { type: 'Point', coordinates: [106, 29] } }));
    await saving;
    assert.equal(workflow.selectedRecordCode.value, 'two');
    assert.deepEqual(workflow.pendingCoordinate.value, [107, 30]);
    assert.equal(workflow.message.value, '');
  } finally { workflow.dispose?.(); globalThis.fetch = originalFetch; }
});

test('save confirmation identifies a newer unsaved draft and does not overwrite it', async () => {
  const originalFetch = globalThis.fetch;
  let finishSave;
  globalThis.fetch = async (_url, options = {}) => options.method === 'PATCH'
    ? new Promise(resolve => { finishSave = resolve; }) : jsonResponse({ features: [record('one')] });
  const workflow = useSurveyRecords({ apiBaseUrl: 'http://api.test' });
  try {
    await workflow.loadRecords();
    workflow.pendingCoordinate.value = [106, 29];
    const pending = workflow.saveLocation();
    workflow.pendingCoordinate.value = [107, 30];
    finishSave(jsonResponse({ geometry: { type: 'Point', coordinates: [106, 29] } }));
    await pending;
    assert.deepEqual(workflow.selectedFeature.value.geometry.coordinates, [106, 29]);
    assert.deepEqual(workflow.pendingCoordinate.value, [107, 30]);
    assert.match(workflow.message.value, /新位置尚未保存/);
  } finally { workflow.dispose(); globalThis.fetch = originalFetch; }
});
