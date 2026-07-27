'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, SHARED } = require('./harness');

function ctx(stored) {
  return load([...SHARED, 'content/config.js', 'content/history.js'], { storage: stored ? { conversionHistory: stored } : {} });
}

test('history persists a debounced batch', async () => {
  const { FTM, storage } = ctx();
  FTM.history.record('a.pdf', 10, '.pdf', 5);
  FTM.history.record('b.pdf', 20, '.pdf', 7);
  assert.equal(storage.data.conversionHistory, undefined, 'writes must be debounced');
  await FTM.history.flush();
  assert.deepEqual([...storage.data.conversionHistory].map((e) => e.file), ['a.pdf', 'b.pdf']);
});

test('history merges with another tab instead of overwriting it', async () => {
  const other = [{ file: 'other.pdf', size: 1, extension: '.pdf', timestamp: '2020-01-01T00:00:00.000Z', outputSize: 1 }];
  const { FTM, storage } = ctx(other);
  FTM.history.record('mine.pdf', 2, '.pdf', 2);
  await FTM.history.flush();
  const files = [...storage.data.conversionHistory].map((e) => e.file);
  assert.deepEqual(files, ['other.pdf', 'mine.pdf']);
});

test('history honours the configured cap', async () => {
  const { FTM, storage } = ctx();
  FTM.applyConfig({ maxConversions: 3 });
  for (let i = 0; i < 6; i++) FTM.history.record('f' + i, 1, '.txt', 1);
  await FTM.history.flush();
  assert.equal(storage.data.conversionHistory.length, 3);
});

test('a failed write keeps the batch for the next flush', async () => {
  const { FTM, storage } = ctx();
  const set = storage.set.bind(storage);
  storage.set = () => Promise.reject(new Error('quota'));
  FTM.history.record('a.pdf', 1, '.pdf', 1);
  await FTM.history.flush();
  storage.set = set;
  await FTM.history.flush();
  assert.deepEqual([...storage.data.conversionHistory].map((e) => e.file), ['a.pdf']);
});
