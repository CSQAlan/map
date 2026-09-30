import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window ??= { location: { protocol: 'http:', hostname: 'localhost' } };
const { useCollectionWorkflow } = await import('../src/composables/useCollectionWorkflow.js');

const okJson = (payload) => ({ ok: true, json: async () => payload });

test('collection submit and audit preserve routes, payload fields, and admin authorization', async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith('/api/collect/segments') && !options.method) {
      return okJson([{ segment_code: 'seg-1', width_m: 1.8, surface_type: 'PAVING' }]);
    }
    if (url.includes('/api/collect/pending')) return okJson([]);
    return okJson({ id: 42, status: 'PENDING', message: '审核完成' });
  };
  try {
    const workflow = useCollectionWorkflow({
      apiBaseUrl: 'http://api.test',
      adminAccessToken: () => 'review-token',
      auditAccessToken: () => 'admin-token',
      loadMapData: async () => {},
    });
    await workflow.loadSegments();
    assert.equal(workflow.collectionForm.value.segment_code, 'seg-1');
    assert.equal(workflow.collectionForm.value.width_m, 1.8);
    workflow.collectionForm.value.remark = '路面平整';
    const submittedForm = JSON.parse(JSON.stringify(workflow.collectionForm.value));
    await workflow.submitCollection();
    const submit = requests.find(({ url, options }) => options.method === 'POST' && url.endsWith('/api/collect/segments'));
    assert.deepEqual(JSON.parse(submit.options.body), submittedForm);

    await workflow.auditCollection({ id: 42 }, 'APPROVED');
    const audit = requests.find(({ url }) => url.endsWith('/api/collect/segments/42/audit'));
    assert.equal(audit.options.headers.Authorization, 'Bearer admin-token');
    assert.deepEqual(JSON.parse(audit.options.body), {
      audit_result: 'APPROVED',
      auditor: '系统管理员',
      audit_comment: '现场采集数据通过审核',
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});
