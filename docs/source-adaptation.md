# Source adaptation

This public port was rebuilt after reviewing the four stages of an existing Google Apps Script implementation. It is not a bulk copy of the source export. The private export and internal operating documents are not part of this repository.

| Source concept | Public module | Adaptation |
| --- | --- | --- |
| Event status and date/location channel matching | `detection.js` | Rewritten as pure functions; all channel and account configuration removed |
| Attendance normalization by CRM association label | `attendance.js` | Multiple-label review, preserved labels, waitlist rules, and evidence conflicts retained |
| Relationship-aware follow-up selection | `follow-up.js` | Role exceptions precede commercial relationship exceptions; organization-specific account fields removed |
| Attributed personalization inside fixed templates | `attendance.js`, `pipeline.js` | Fictional reviewed professional context and new generic templates |
| LLM output normalization | `extraction-contract.js` | Proposed standalone schema boundary; no live provider integration |
| CRM task and note preparation | `pipeline.js` | Local work-order objects and proposed sourced notes; staff assignments excluded |
| Registry and duplicate prevention | `pipeline.js` | Stable IDs and a caller-supplied completed-event list; persistent registry omitted |

## Excluded from the public version

- Credentials, Script Properties, authorization state, and service-account configuration.
- Real project, document, spreadsheet, folder, workspace, portal, owner, channel, and event IDs.
- Staff rosters, aliases, personal exceptions, customer records, and real meeting context.
- Internal document links, exact production email templates, and company-specific categorization lists.
- A separate account-specific reporting script that was outside the follow-up pipeline.
- Live-service adapters, trigger installers, and operational handoff procedures.

## Deliberate behavior changes

Contact restrictions hold email preparation for review. A sender needs a verified alias. Any conflicting evidence or multiple association labels blocks automatic email eligibility. This port uses a simplified full-location channel matcher, synthetic inputs, and local outputs.

## Authorship and claims

This is an AI-assisted portfolio rebuild of a workflow the portfolio owner built and operated. It does not imply sole authorship of every original integration or certify production outcomes. No revenue, response-rate, time-savings, or reliability metric is attributed to this demo.
