import assert from 'node:assert/strict';
import { test } from 'node:test';

const journeys = {
  expert: ['inline-edit', 'save'],
  assisted: ['guided-details', 'review', 'save'],
};
export function stepsFor(actor) {
  if (!Object.hasOwn(journeys, actor)) throw new Error('Unknown actor');
  return [...journeys[actor]];
}
export function failedSave(draft) {
  return { draft, error: 'Order could not be saved. Retry.', canRetry: true };
}
test('profiles retain their own steps and copies', () => {
  assert.deepEqual(stepsFor('expert'), ['inline-edit', 'save']);
  assert.deepEqual(stepsFor('assisted'), ['guided-details', 'review', 'save']);
  stepsFor('expert').push('unexpected');
  assert.equal(stepsFor('expert').length, 2);
  assert.throws(() => stepsFor('unknown'), /Unknown actor/);
});
test('failed saves retain either draft', () => {
  assert.equal(failedSave('edited name').draft, 'edited name');
  assert.equal(failedSave('').draft, '');
  assert.equal(failedSave('edited name').canRetry, true);
});
