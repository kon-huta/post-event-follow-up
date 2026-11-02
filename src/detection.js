/** Date/channel matching adapted from the source workflow; no service access. */
const words = text => String(text ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]+/g) ?? [];
const compact = text => words(text).join('');

export function classifyEvent(event) {
  if (event.cancelled || event.calendarStatus === 'cancelled' || /\b(cancel+ed|cancel+ation)\b/i.test(event.title ?? '')) return 'cancelled';
  if (/^\W*(planning\s+)?hold\b/i.test(event.title ?? '')) return 'hold';
  if (event.calendarStatus === 'tentative' || /\b(postponed|rescheduled?|tentative|tbd|tbc)\b/i.test(event.title ?? '')) return 'review';
  return 'active';
}

export function parseChannelName(name) {
  const match = /^(.*?)-(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})$/.exec(String(name));
  if (!match) return null;
  const year = Number(match[4]) + (match[4].length === 2 ? 2000 : 0);
  const month = Number(match[2]); const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { date: date.toISOString().slice(0, 10), slug: compact(match[1].replace(/^events?-/, '')) };
}

export function matchEventChannel(event, channels, siblings = [], override = '') {
  const unclear = reason => ({ status: 'unclear', channel: null, reason });
  if (override) {
    const wanted = override.replace(/^#/, '');
    const found = channels.filter(c => !c.archived && (c.id === wanted || c.name === wanted));
    return found.length === 1 ? { status: 'matched', channel: found[0], method: 'reviewer override' } : unclear('Override does not identify one active channel');
  }
  const dated = channels.filter(c => !c.archived).map(channel => ({ channel, parsed: parseChannelName(channel.name) })).filter(c => c.parsed?.date === event.date);
  const hits = (candidate, field) => {
    const token = compact(field);
    return token.length > 2 && candidate.parsed.slug.includes(token);
  };
  const select = (candidates, method, field) => {
    if (candidates.length !== 1) return unclear('Multiple channels match the event');
    const only = candidates[0];
    if (siblings.some(s => s.date === event.date && hits(only, s[field]))) return unclear('A second event could claim the same channel');
    return { status: 'matched', channel: only.channel, method };
  };
  const venue = dated.filter(c => hits(c, event.venue));
  if (venue.length) return select(venue, 'date and venue', 'venue');
  const city = dated.filter(c => hits(c, event.city));
  if (city.length) return select(city, 'date and city', 'city');
  return unclear('No channel unambiguously matches the event date and location');
}
