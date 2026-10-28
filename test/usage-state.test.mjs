import test from 'node:test';
import assert from 'node:assert/strict';
import { createUsageState } from '../public/usage-state.js';

test('quota ignores default pushes and stale responses after session changes', async () => {
  const pending = [], shown = [];
  const state = createUsageState({ load: (id, force) => new Promise((resolve, reject) => pending.push({ id, force, resolve, reject })), render: value => shown.push(value) });
  state.acceptDefault({ fiveHour: 100 });
  state.select('second'); const first = state.refresh();
  assert.equal(state.acceptDefault({ fiveHour: 100 }), false);
  state.select('third'); const next = state.refresh(true);
  pending[1].resolve({ fiveHour: 30 }); assert.equal(await next, true);
  pending[0].resolve({ fiveHour: 20 }); assert.equal(await first, false);
  assert.deepEqual(shown.at(-1), { fiveHour: 30 });
  assert.equal(pending[1].id, 'third'); assert.equal(pending[1].force, true);
  const old = state.refresh(), latest = state.refresh();
  pending[3].resolve({ fiveHour: 31 }); await latest;
  pending[2].reject(new Error('old failure')); assert.equal(await old, false);
  assert.deepEqual(shown.at(-1), { fiveHour: 31 });
  state.select(null); assert.equal(shown.at(-1), null);
  state.acceptDefault({ fiveHour: 100 }); assert.deepEqual(shown.at(-1), { fiveHour: 100 });
});

test('a failed current quota request clears old limits instead of showing another account', async () => {
  const shown = [];
  const state = createUsageState({ load: async () => { throw new Error('profile disabled'); }, render: value => shown.push(value) });
  state.select('second');
  await assert.rejects(state.refresh(), /profile disabled/);
  assert.deepEqual(shown.at(-1), { stale: true, unavailableReason: 'profile disabled' });
});

test('draft choices isolate quota from default pushes and earlier draft responses', async () => {
  const pending = [], shown = [];
  const state = createUsageState({ load: (id, force, choices) => new Promise(resolve => pending.push({ id, choices, resolve })), render: value => shown.push(value) });
  state.select(null, { 'account-pool': 'first' }); const first = state.refresh();
  state.select(null, { 'account-pool': 'second' }); const second = state.refresh();
  assert.equal(state.acceptDefault({ fiveHour: 100 }), false);
  assert.deepEqual(pending[1].choices, { 'account-pool': 'second' });
  pending[1].resolve({ fiveHour: 20 }); await second;
  pending[0].resolve({ fiveHour: 100 }); assert.equal(await first, false);
  assert.deepEqual(shown.at(-1), { fiveHour: 20 });
});
