import { createHash } from 'node:crypto';

import { associationLabels, validateContact, reconcile, usableContext } from './attendance.js';
import { followUpType } from './follow-up.js';
import { classifyEvent, matchEventChannel } from './detection.js';
export { reconcile } from './attendance.js';
const stableId = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);

function localParts(iso, timeZone) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(new Date(iso)).map(p => [p.type, p.value]));
}

function validate(input, now) {
  const { event, contacts, hosts } = input;
  if (!event?.id || !event.venue || !event.city || !event.timeZone || !event.date) throw new Error('Event identity, date, venue, city, and time zone are required.');
  if (!Array.isArray(input.channels)) throw new Error('Channels must be an array.');
  if (!['dinner', 'lunch', 'brunch'].includes(event.kind)) throw new Error('Unsupported event kind.');
  if (!Number.isFinite(Date.parse(event.end)) || !Number.isFinite(Date.parse(now))) throw new Error('Invalid timestamp.');
  if (!Array.isArray(contacts) || !Array.isArray(hosts)) throw new Error('Contacts and hosts must be arrays.');
  const ids = new Set();
  for (const c of contacts) {
    if (!c.id || ids.has(c.id)) throw new Error('Every contact needs a unique ID.');
    ids.add(c.id);
    validateContact(c);
  }
  localParts(now, event.timeZone); // Also validates the IANA time zone.
}

function readyToReconcile(event, now) {
  const end = Date.parse(event.end);
  const current = Date.parse(now);
  if (current < end) return false;
  if (event.kind !== 'dinner') return current >= end + 30 * 60_000;
  const ended = localParts(event.end, event.timeZone);
  const today = localParts(now, event.timeZone);
  const dateKey = p => `${p.year}-${p.month}-${p.day}`;
  return dateKey(today) > dateKey(ended) && (Number(today.hour) * 60 + Number(today.minute)) >= 510;
}

function buildDraft(contact, type, event, host) {
  const eventDay = localParts(event.end, event.timeZone);
  const meetingAsk = ['prospect', 'active_need'].includes(type);
  const when = ['Thu', 'Fri', 'Sat', 'Sun'].includes(eventDay.weekday) ? 'next week' : 'later this week or next week';
  const greeting = contact.returningWithin12Months ? 'great to see you again' : 'great to meet you';
  const context = usableContext(contact).map(item => ` ${item.text}`).join('');
  const closing = meetingAsk ? `What are some days and times ${when} that work for a conversation?` : 'Thanks again for being part of the conversation. Let’s stay in touch.';
  return {
    id: stableId(event.id, contact.id, 'personal'), kind: 'personal', to: [contact.email], from: host.email,
    type, status: 'needs_review', subject: meetingAsk ? "Great seeing you, let's catch up!" : `Thank you for joining us at ${event.venue}`,
    body: `Hi ${contact.name},\n\nIt was ${greeting} at ${event.venue}!${context}\n\n${closing}\n\n${host.name}`
  };
}

/** Pure orchestration: produces proposed artifacts. It never calls an external service. */
export function runPipeline(input, { now, previousEventIds = [] } = {}) {
  validate(input, now);
  const { event, contacts, hosts } = input;
  const result = { eventId: event.id, status: 'waiting', markers: [], decisions: [], drafts: [], workOrders: [], insights: [], reviewItems: [] };
  const eligibility = classifyEvent(event);
  if (['cancelled', 'hold'].includes(eligibility)) return { ...result, status: 'skipped', reason: `Event is ${eligibility}` };
  if (eligibility === 'review') return { ...result, status: 'blocked', reason: 'Event is tentative or rescheduled', reviewItems: ['Confirm event status'], markers: ['ACTION_REQUIRED'] };
  const channel = matchEventChannel(event, input.channels, input.siblingEvents ?? [], event.channelOverride);
  result.channelMatch = channel;
  if (channel.status !== 'matched') return { ...result, status: 'blocked', reason: channel.reason, reviewItems: [channel.reason], markers: ['ACTION_REQUIRED'] };
  if (previousEventIds.includes(event.id)) return { ...result, status: 'already_processed', reason: 'Registry contains a completed run' };
  if (Date.parse(now) < Date.parse(event.end)) return { ...result, reason: 'Event has not ended' };
  result.markers.push('READY_FOR_POST_EVENT');
  if (!readyToReconcile(event, now)) return { ...result, reason: 'Reconciliation window has not opened' };
  if (!event.notesAvailable && Date.parse(now) < Date.parse(event.end) + 24 * 3_600_000) {
    return { ...result, reason: 'Waiting for meeting notes, up to 24 hours after the event' };
  }
  if (!event.notesAvailable) result.reviewItems.push('Meeting notes unavailable after the waiting period');
  const host = hosts.find(h => h.onSiteVerified && h.aliasVerified && h.email);
  if (!host) result.reviewItems.push('No verified on-site host with a sender alias');

  for (const contact of contacts) {
    const attendance = reconcile(contact);
    const [type, reason] = followUpType(contact, attendance.attendance, now);
    result.decisions.push({ contactId: contact.id, name: contact.name, ...attendance, type, emailReason: reason });
    if (type === 'review') result.reviewItems.push(`${contact.name}: ${attendance.needsDecision ? attendance.reason : reason}`);
    const labels = associationLabels(contact);
    const label = labels.length === 1 ? labels[0] : undefined;
    if (!contact.internal) {
      let target;
      if (['Registered', 'Waitlisted'].includes(label) && attendance.attendance === 'attended') target = 'Attendees';
      if (label === 'Registered' && attendance.attendance === 'no_show') target = 'Non-Attendees';
      if (contact.walkIn && contact.identityConfirmed && attendance.attendance === 'attended' && !labels.length) target = 'Attendees';
      if (target && !(contact.walkIn && !contact.identityConfirmed)) {
        result.workOrders.push({ id: stableId(event.id, contact.id, target), contactId: contact.id, from: label ?? 'Unlinked', to: target, action: label ? 'request_label_change' : 'request_association', status: 'needs_human_action' });
      } else if (attendance.attendance === 'unclear' || type === 'review' || (attendance.attendance === 'withdrew' && label === 'Registered')) {
        result.workOrders.push({ id: stableId(event.id, contact.id, 'decision'), contactId: contact.id, action: 'request_decision', reason: attendance.needsDecision ? attendance.reason : (attendance.attendance === 'withdrew' ? 'Verify withdrawal and association label' : reason), status: 'needs_human_action' });
      }
    }
    if (host && !['no_email', 'review'].includes(type)) result.drafts.push(buildDraft(contact, type, event, host));
    if (attendance.attendance === 'attended' && !(contact.walkIn && !contact.identityConfirmed) && !contact.internal) {
      for (const item of usableContext(contact)) result.insights.push({ contactId: contact.id, text: item.text, reference: item.reference, status: 'proposed_note' });
    }
  }
  result.markers.push('POST_EVENT_RECONCILED');
  const eligible = result.drafts.filter(d => d.kind === 'personal');
  if (host && eligible.length) {
    result.drafts.unshift({
      id: stableId(event.id, 'group'), kind: 'group', to: eligible.flatMap(d => d.to), from: host.email,
      status: 'needs_review', subject: `Thank you for joining us at ${event.venue}!`,
      body: `Thank you all for joining us at ${event.venue}. We appreciated the conversation and hope to see you again soon.\n\n${host.name}`
    });
  }
  result.status = result.reviewItems.length ? 'partial' : 'complete';
  result.markers.push(result.status === 'partial' ? 'POST_EVENT_PARTIAL' : 'POST_EVENT_COMPLETE');
  if (result.workOrders.length) result.markers.push('CRM_WORK_ORDER');
  if (result.reviewItems.length) result.markers.push('ACTION_REQUIRED');
  return result;
}

export function renderReview(result) {
  const lines = ['# Post-event follow-up review', '', `Status: ${result.status}`, '', 'All messages are local previews requiring human review.', '', '## Attendance and email decisions', ''];
  for (const d of result.decisions) lines.push(`- **${d.name}**: ${d.attendance}; ${d.type}. ${d.emailReason}. Evidence: ${d.reason}.`);
  lines.push('', '## Review items', '', ...(result.reviewItems.length ? result.reviewItems.map(r => `- ${r}`) : ['None.']));
  for (const d of result.drafts) lines.push('', `## ${d.kind === 'group' ? 'Group thank-you' : d.to[0]}`, '', `From: ${d.from}`, '', `Subject: ${d.subject}`, '', d.body);
  lines.push('', '## CRM work orders', '', ...result.workOrders.map(w => `- ${w.contactId}: ${w.action}${w.to ? ` (${w.from} → ${w.to})` : ` (${w.reason})`}`));
  return lines.join('\n') + '\n';
}
