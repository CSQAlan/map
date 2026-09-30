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
