/** Role exceptions precede commercial relationship exceptions, as in the source workflow. */
export function followUpType(contact, attendance, now) {
  if (contact.internal) return ['no_email', 'Internal host or teammate'];
  if (contact.doNotContact || contact.optedOut) return ['review', 'Contact restriction requires review'];
  if (attendance !== 'attended') return [attendance === 'unclear' ? 'review' : 'no_email', `Attendance: ${attendance}`];
  if (contact.walkIn && !contact.identityConfirmed) return ['review', 'Walk-in identity needs confirmation'];
  if (!contact.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) return ['review', 'Missing or invalid email'];
  if (['between_roles', 'student', 'contractor', 'consultant', 'new_job'].includes(contact.relationship)) return ['relationship', 'Relationship-building follow-up'];
  const sinceMeeting = Date.parse(now) - Date.parse(contact.lastMeetingAt);
  if (contact.customer || contact.openDeal || (sinceMeeting >= 0 && sinceMeeting <= 90 * 86_400_000)) return ['thank_you', 'Customer, open deal, or meeting within 90 days'];
  if (contact.activeNeed) return ['active_need', 'Current need indicated by the normalized input'];
  return ['prospect', 'Attended with no relationship exception'];
}
