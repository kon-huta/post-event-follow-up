import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runPipeline } from '../src/pipeline.js';

const example = JSON.parse(await readFile(new URL('../examples/event.json', import.meta.url), 'utf8'));
const NOW = '2026-10-30T16:00:00Z';
const run = (input, options = {}) => runPipeline(input, { now: NOW, ...options });
const fresh = () => structuredClone(example);
const decision = (result, id) => result.decisions.find(d => d.contactId === id);

test('attendee with an active need gets a contextual draft and a proposed label change', () => {
  const result = run(fresh());
  assert.equal(decision(result, 'guest-01').type, 'active_need');
  const draft = result.drafts.find(d => d.to.includes('maya@example.com') && d.kind === 'personal');
  assert.match(draft.body, /customer onboarding/);
  assert.match(draft.body, /next week/);
  assert.equal(draft.status, 'needs_review');
  assert.ok(result.workOrders.some(w => w.contactId === 'guest-01' && w.to === 'Attendees'));
});

test('customer and between-role guests receive no meeting ask', () => {
  const result = run(fresh());
  assert.equal(decision(result, 'guest-02').type, 'thank_you');
  assert.equal(decision(result, 'guest-03').type, 'relationship');
  for (const address of ['jordan@example.com', 'sam@example.com']) {
    const draft = result.drafts.find(d => d.kind === 'personal' && d.to.includes(address));
    assert.doesNotMatch(draft.body, /days and times/);
  }
});

test('conflicting evidence is held and excluded from every email', () => {
  const result = run(fresh());
  assert.equal(decision(result, 'guest-05').attendance, 'unclear');
  assert.equal(decision(result, 'guest-05').type, 'review');
  assert.ok(!result.drafts.some(d => d.to.includes('riley@example.com')));
  assert.ok(result.workOrders.some(w => w.contactId === 'guest-05' && w.action === 'request_decision'));
});

test('no-show and waitlisted guest without a seat receive no emails; only no-show gets label request', () => {
  const result = run(fresh());
  assert.equal(decision(result, 'guest-04').type, 'no_email');
  assert.equal(decision(result, 'guest-06').type, 'no_email');
  assert.ok(result.workOrders.some(w => w.contactId === 'guest-04' && w.to === 'Non-Attendees'));
  assert.ok(!result.workOrders.some(w => w.contactId === 'guest-06'));
});

test('unconfirmed walk-in and opted-out attendee are excluded from group and individual drafts', () => {
  const result = run(fresh());
  for (const address of ['morgan@example.com', 'jamie@example.com']) {
    assert.ok(!result.drafts.some(d => d.to.includes(address)));
  }
  assert.equal(result.status, 'partial');
  assert.ok(result.markers.includes('ACTION_REQUIRED'));
});

test('missing sender alias blocks all draft creation', () => {
  const input = fresh(); input.hosts[0].aliasVerified = false;
  const result = run(input);
  assert.equal(result.drafts.length, 0);
  assert.equal(result.status, 'partial');
});

test('missing notes wait until 24 hours, then produce a flagged partial run', () => {
  const input = fresh(); input.event.notesAvailable = false;
  assert.equal(run(input).status, 'waiting');
  const late = run(input, { now: '2026-10-31T16:00:00Z' });
  assert.equal(late.status, 'partial');
  assert.ok(late.reviewItems.some(i => i.includes('Meeting notes unavailable')));
});

test('dinner reconciliation waits until 08:30 Pacific, independent of host time zone', () => {
  assert.equal(run(fresh(), { now: '2026-10-30T15:29:00Z' }).status, 'waiting');
  assert.notEqual(run(fresh(), { now: '2026-10-30T15:30:00Z' }).status, 'waiting');
});

test('lunch reconciliation opens 30 minutes after the end', () => {
  const input = fresh(); input.event.kind = 'lunch'; input.event.end = '2026-10-30T20:00:00Z';
  assert.equal(run(input, { now: '2026-10-30T20:29:00Z' }).status, 'waiting');
  assert.notEqual(run(input, { now: '2026-10-30T20:30:00Z' }).status, 'waiting');
});

test('runs do not mutate input and reruns retain artifact IDs', () => {
  const input = fresh(); const original = structuredClone(input);
  assert.deepEqual(run(input), run(input));
  assert.deepEqual(input, original);
  assert.equal(run(input, { previousEventIds: [input.event.id] }).status, 'already_processed');
});

test('customer relationship takes priority over an active need', () => {
  const input = fresh(); input.contacts[0].customer = true;
  assert.equal(decision(run(input), 'guest-01').type, 'thank_you');
});

test('duplicate contact IDs are rejected before generating artifacts', () => {
  const input = fresh(); input.contacts[1].id = input.contacts[0].id;
  assert.throws(() => run(input), /unique ID/);
});

test('cancelled events produce no drafts or work orders', () => {
  const input = fresh(); input.event.cancelled = true;
  const result = run(input);
  assert.equal(result.status, 'skipped');
  assert.equal(result.drafts.length, 0);
  assert.equal(result.workOrders.length, 0);
});
