import test from 'node:test';
import assert from 'node:assert/strict';
import { findOptionByValue } from '../src/utils/options.js';

test('finds a selected destination in the map options list', () => {
  const destinations = [{ value: 'poi-1', label: '社区服务中心' }];
  assert.deepEqual(findOptionByValue(destinations, 'poi-1'), destinations[0]);
});

test('returns undefined when the selected destination is missing', () => {
  assert.equal(findOptionByValue([], 'poi-1'), undefined);
});
