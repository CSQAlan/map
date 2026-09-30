import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSosPayload } from '../src/services/emergency.js';

test('SOS payload includes the selected destination and current route context', () => {
  assert.deepEqual(buildSosPayload({
    user: { id: 7, role: 'elder', realName: '王阿姨' },
    isGuest: false,
    mobilityType: 'CANE',
    selectedRoute: { summary: '经社区中路前往' },
    currentStep: '沿社区中路前进',
    destination: { label: '社区卫生服务中心' },
  }), {
    elder_user_id: 7,
    elder_name: '王阿姨',
    mobility_type: 'CANE',
    route_summary: '经社区中路前往',
    current_step: '沿社区中路前进',
    destination_name: '社区卫生服务中心',
  });
});
