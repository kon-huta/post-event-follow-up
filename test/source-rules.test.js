import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyEvent, parseChannelName, matchEventChannel } from '../src/detection.js';
import { reconcile, usableContext } from '../src/attendance.js';
import { validateExtraction } from '../src/extraction-contract.js';
import { runPipeline } from '../src/pipeline.js';

const sample = JSON.parse(await readFile(new URL('../examples/event.json', import.meta.url), 'utf8'));
const fresh = () => structuredClone(sample);
const run = input => runPipeline(input, { now: '2026-10-30T16:00:00Z' });
const evidence = outcome => [{ source: 'slack', reference: 'demo-reference', outcome }];

test('hold and rescheduled calendar titles do not proceed', () => {
  assert.equal(classifyEvent({ title: 'HOLD: Dinner' }), 'hold');
  assert.equal(classifyEvent({ title: 'Rescheduled dinner' }), 'review');
  assert.equal(classifyEvent({ title: 'Cancelled dinner' }), 'cancelled');
});

test('channel suffix parser rejects impossible dates', () => {
  assert.equal(parseChannelName('event-harbor-city-02-30-26'), null);
  assert.equal(parseChannelName('event-harbor-city-10-29-26').date, '2026-10-29');
});

test('channel matching holds same-city ambiguity and supports an explicit override', () => {
  const input = fresh();
  input.channels.push({ id: 'demo-channel-02', name: 'events-harbor-city-10-29-26' });
  assert.equal(matchEventChannel(input.event, input.channels).status, 'unclear');
  assert.equal(matchEventChannel(input.event, input.channels, [], 'demo-channel-02').status, 'matched');
  assert.equal(run(input).status, 'blocked');
});

test('a sibling event prevents automatically claiming its channel', () => {
  const input = fresh();
  const sibling = { ...input.event, id: 'demo-event-02', venue: 'Another House' };
  assert.equal(matchEventChannel(input.event, input.channels, [sibling]).status, 'unclear');
});

test('multiple association labels require review even with positive attendance', () => {
  assert.equal(reconcile({ labels: ['Registered', 'Rejected'], evidence: evidence('attended') }).attendance, 'unclear');
});

test('an unlabeled association needs a decision rather than being treated as an attendee', () => {
  assert.equal(reconcile({ labels: [], evidence: evidence('attended') }).attendance, 'unclear');
});

test('waitlisted no-shows become not seated without a label-change work order', () => {
  const input = fresh();
  input.contacts[0].labels = ['Waitlisted']; input.contacts[0].evidence = evidence('no_show');
  const result = run(input);
  assert.equal(result.decisions[0].attendance, 'not_seated');
  assert.ok(!result.workOrders.some(w => w.contactId === input.contacts[0].id));
});

test('preserved withdrawal label plus attendance requires a decision', () => {
  const input = fresh(); input.contacts[0].labels = ['UN-RSVP'];
  const result = run(input);
  assert.equal(result.decisions[0].attendance, 'unclear');
  assert.ok(!result.drafts.some(d => d.to.includes(input.contacts[0].email)));
});

test('a confirmed walk-in gets a proposed association and a draft', () => {
  const input = fresh(); input.contacts[6].identityConfirmed = true;
  const result = run(input);
  assert.ok(result.workOrders.some(w => w.contactId === 'guest-07' && w.action === 'request_association'));
  assert.ok(result.drafts.some(d => d.kind === 'personal' && d.to.includes('morgan@example.com')));
});

test('role status takes precedence over customer status', () => {
  const input = fresh(); input.contacts[0].customer = true; input.contacts[0].relationship = 'student';
  assert.equal(run(input).decisions[0].type, 'relationship');
});

test('only reviewed professional context attributed to this guest enters the draft', () => {
  const input = fresh(); const contact = input.contacts[0];
  const valid = contact.contextEvidence[0];
  contact.contextEvidence.push(
    { ...valid, text: 'Personal detail', category: 'personal' },
    { ...valid, text: 'Private account assessment', category: 'internal' },
    { ...valid, text: 'Different speaker', speakerId: 'guest-02' },
    { ...valid, text: 'Unreviewed statement', approved: false }
  );
  assert.equal(usableContext(contact).length, 1);
  const body = run(input).drafts.find(d => d.kind === 'personal' && d.to.includes(contact.email)).body;
  assert.doesNotMatch(body, /Personal detail|Private account|Different speaker|Unreviewed/);
});

test('model output cannot introduce an unknown identity or source', () => {
  const scope = { contactIds: ['guest-01'], sources: [{ id: 'source-01', kind: 'slack' }] };
  assert.throws(() => validateExtraction({ contacts: [{ contactId: 'unknown', evidence: [] }] }, scope), /Unknown/);
  assert.throws(() => validateExtraction({ contacts: [{ contactId: 'guest-01', evidence: [{ sourceId: 'unknown', outcome: 'attended' }] }] }, scope), /Invalid/);
  assert.throws(() => validateExtraction({ contacts: [{ contactId: 'guest-01', evidence: [] }, { contactId: 'guest-01', evidence: [] }] }, scope), /duplicate/);
});

test('model output is normalized to known source references', () => {
  const result = validateExtraction({ contacts: [{ contactId: 'guest-01', evidence: [{ sourceId: 'source-01', outcome: 'attended' }] }] }, {
    contactIds: ['guest-01'], sources: [{ id: 'source-01', kind: 'slack' }]
  });
  assert.deepEqual(result[0].evidence, [{ source: 'slack', reference: 'source-01', outcome: 'attended' }]);
});
