# Independent frontend review receipt

Reviewer: the separate Phase V Reliability/Recovery agent; this reviewer did not
implement the frontend patch. This is a source/evidence review, not a GitHub
human approval or a substitute for required CI.

| Identity | Reviewed value |
|---|---|
| Baseline | `d0159b1f844bf0608415dded9e84af566c8e2041` |
| Candidate | `75763aa23decb164fd9d369590099c9365e42400` |
| Candidate complete tree | `ecad5b31f2f926eb0ae2f00fa6ce2dc2111a48a6` |
| Independent DOM execution | Node 24.22.1, jsdom 31.0.1, clean committed candidate; **7/7 passed** |
| Verdict | **ACCEPT_SCOPED_CHANGE**, conditional on required source-bound browser/Compose/full CI |

## Reviewed behavior and evidence

The actual diff restores the opening date field after hour/minute Enter, Done,
Clear and Escape. The outside-dismissal path preserves the selected outside
focus target. The existing TimeField Enter handler prevents form submission.
The reviewer reran all seven committed DOM cases and inspected their raw focus,
dialog, submission and goal-state observations:
[frontend-independent.json](frontend-independent.json). The implementer's
baseline records five failures and two passing controls; the defect claims
match those observations and the code change.

LearningGoalPanel retains the last confirmed resource during a read for the
same mounted account, announces that it is refreshing, and disables writes.
The unchanged App route keys LearningPage by both user ID and session identity
version, so an account/login change remounts the panel rather than displaying a
previous account's retained resource. Existing account-switch, token-rotation
and uncertain-mutation browser regressions remain required. This review does
not infer authorization from a disabled UI; backend owner checks are unchanged.

The fourteen new browser cases cover six date-picker paths and eight
320/375/768/1440 × light/dark refresh combinations. They assert actual theme,
retained content, disabled writes, viewport width and downstream geometry and
emit source-bound geometry plus PNGs. They are synthetic UX cases, not server
benchmarks. WebKit selection includes the new file; the coordinator must retain
explicit Firefox selection and success-artifact upload in integration wiring.

The live layout probe copies at most five layout-source rectangles with fixed
region/tag allowlists. No text, arbitrary node identifiers/classes, URLs, input
values or account fields are added. Existing entry caps, observation counts,
functional assertions and metric definitions are retained. The schema and probe
version change explicitly identify additive measurement. Layout-source nodes
are affected content, not proven initiating causes. INP remains null; no small
bundle delta is called a performance gain. The adverse historical LCP/CLS
observations are retained with the separate-run/small-sample qualification.

## Remaining gates

There are no source-review blocking findings in this scoped patch. Actual
browser assertions were **not executed locally**: the documented browser
download/startup attempts failed before assertions. The independent DOM rerun
does not establish layout, paint, native keyboard default actions, screenshots,
screen-reader support or browser performance. Actual Chromium/WebKit/Firefox,
live Compose measurements and full exact-source CI are required before merge.
If the candidate changes beyond this reviewed tree, review the new diff and bind
the receipt to the new source. Full device/a11y and field metrics remain external.
