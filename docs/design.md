# Design notes

## Separate evidence from action

The original Apps Script workflow reconciles attendance before creating follow-up drafts or CRM work orders. This port retains that boundary. The core accepts normalized evidence and emits proposals; it cannot send messages or change associations.

Conflicting evidence produces a review item. Neither a channel message nor a meeting note wins automatically. Multiple association labels also require a decision. Existing withdrawal and non-registration labels are preserved unless a reviewer resolves contradictory attendance evidence.

## Event matching

Channel names encode a calendar date. The matcher first looks for the venue and then the city on that date, rejects ambiguous matches and sibling-event collisions, and supports an explicit reviewer override. Archived channels are excluded. Location matching is intentionally simplified: it uses normalized full city or venue text rather than the original implementation's abbreviation vocabulary. An unmatched event blocks processing.

Cancelled and hold events are skipped. Tentative or rescheduled events are blocked for review. Dinner reconciliation opens at 08:30 the next local day. Lunch and brunch reconciliation opens 30 minutes after ending. Missing meeting notes hold a run until 24 hours after the event, then produce a review item. The sample explicitly sets an IANA time zone, so host-machine time does not determine the schedule.

## Attendance and CRM policy

Registered attendees get a proposed change to Attendees; registered no-shows get a proposed change to Non-Attendees. Waitlisted attendees can become Attendees, while waitlisted no-shows or withdrawals are treated as not admitted. An identity-confirmed walk-in gets a proposed association request. An unconfirmed walk-in is held.

The demo produces one conceptual work order per change, without staff assignments or due-date integrations. It does not implement task closure, create contacts, or change labels. A correct label request can coexist with a hold on email preparation.

## Follow-up precedence

After checking attendance, identity, and contact restrictions, role exceptions take priority: between roles, student, contractor, consultant, and starting a new job all get relationship copy. Customers, open deals, and meetings within 90 days then get a thank-you without a meeting ask. A current need selects the active-need variant; other eligible attendees get prospect copy.

The public port deliberately holds opted-out and do-not-contact guests for review rather than overriding those flags. It also requires a verified sender alias instead of falling back to a shared inbox. These are public-demo policy choices, not claims about the original system.

## The AI boundary

The original implementation uses an LLM to interpret attendance and extract attributed conversation context, then constrains personalized writing to part of a fixed template. This demo does not call a model. The fictional fixture supplies normalized evidence, role status, context approval, and host verification.

`extraction-contract.js` includes instructions and a validator for a future attendance extractor. The validator rejects unknown contacts, duplicate contacts, unknown source references, and unsupported outcomes. Those checks establish record shape and identity boundaries, not semantic truth or resistance to every prompt-injection attempt.

Only context explicitly marked approved, professional, and attributed to the guest can enter templates and proposed CRM notes. Personal details, internal assessments, other speakers' statements, and unreviewed snippets are excluded. The approval flag is a demonstration input, not an implemented approval interface.

## State and retries

Stable IDs depend on the event, contact, and artifact purpose. Replaying the same input creates the same IDs and overwrites the same local demo files. A caller can supply completed-event IDs to skip an event. There is no persistent state store or external transaction in this port.

A production adapter would need durable upserts, concurrency control, per-stage retry counts, and recovery after partial writes. A PARTIAL run should not be marked complete just because some drafts were created. COMPLETE describes draft preparation, not delivery or completed CRM changes.

## Verification and limits

The tests exercise policy decisions, ambiguous evidence, source validation, scheduling, cancellation, sender requirements, and deterministic output. They do not test live APIs, extraction quality, deliverability, or production outcomes. The public-file scan finds common secret and identifier patterns; it is a useful publication check rather than a guarantee that arbitrary text is safe to publish.
