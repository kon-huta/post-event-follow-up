const LABELS = new Set(['Registered', 'Waitlisted', 'Attendees', 'Non-Attendees', 'UN-RSVP', 'Interested', 'Rejected']);
const OUTCOMES = new Set(['attended', 'no_show', 'withdrew', 'unclear', 'disputed']);

export function associationLabels(contact) {
  return contact.labels ?? (contact.label ? [contact.label] : []);
}

export function validateContact(contact) {
  const labels = associationLabels(contact);
  if (!contact.name || !Array.isArray(labels) || labels.some(l => !LABELS.has(l))) throw new Error('Invalid contact name or association label');
  for (const item of contact.evidence ?? []) {
    if (!['slack', 'meeting_notes'].includes(item.source) || !item.reference || !OUTCOMES.has(item.outcome)) {
      throw new Error('Evidence needs a supported source, reference, and outcome');
    }
  }
  for (const item of contact.contextEvidence ?? []) {
    if (!item.reference || !item.text || !item.speakerId || !['professional', 'personal', 'internal'].includes(item.category)) {
      throw new Error('Context requires text, a source reference, speaker identity, and a category');
    }
  }
}

/** Deterministic normalization after evidence extraction; does not interpret raw notes. */
export function reconcile(contact) {
  const labels = associationLabels(contact);
  const evidence = (contact.evidence ?? []).filter(e => e.outcome !== 'unclear');
  const outcomes = [...new Set(evidence.map(e => e.outcome))];
  const result = (attendance, reason, needsDecision = false) => ({ attendance, reason, needsDecision, evidence });
  if (labels.length > 1) return result('unclear', 'Multiple CRM association labels require review', true);
  if (outcomes.includes('disputed') || outcomes.length > 1) return result('unclear', 'Conflicting attendance evidence', true);
  const label = labels[0];
  if (!label && !contact.walkIn) return result(outcomes[0] === 'attended' ? 'unclear' : 'not_registered', 'Unlabeled association requires review before treating a contact as an attendee', outcomes[0] === 'attended');
  if (['UN-RSVP', 'Interested', 'Rejected'].includes(label)) {
    if (outcomes[0] === 'attended') return result('unclear', 'Attendance conflicts with a preserved association label', true);
    return result(label === 'UN-RSVP' ? 'withdrew' : 'not_registered', 'Existing association label is preserved');
  }
  if (label === 'Attendees') return result('attended', 'Existing CRM attendee label');
  if (label === 'Non-Attendees') return result('no_show', 'Existing CRM non-attendee label');
  if (label === 'Waitlisted' && ['no_show', 'withdrew'].includes(outcomes[0])) return result('not_seated', 'Waitlisted guest was not admitted');
  if (outcomes.length === 1) return result(outcomes[0], 'Supported by event evidence');
  if (label === 'Waitlisted' && contact.seatConfirmed === false) return result('not_seated', 'Waitlisted without a seat');
  return result('unclear', 'No conclusive attendance evidence', true);
}

/** Only attributed, professional, explicitly reviewed context enters templates. */
export function usableContext(contact) {
  return (contact.contextEvidence ?? []).filter(item => item.speakerId === contact.id && item.category === 'professional' && item.approved === true);
}
