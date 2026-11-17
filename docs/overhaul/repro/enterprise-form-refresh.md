# Scheduled-test draft preservation during token refresh

Independent review of `1011e35e1fbad2327794e5a615bba9bc3115ece0` found a P2 data-loss path: the enterprise edit screen reads its test with `useEnterpriseTest`, which clears the fetched record when the access token changes. The parent then replaces `TestForm` with its loading state. Returning the record creates a new form and discards unsaved text and version-refresh selection, despite the login being unchanged. It can also invalidate a pending save's mounted ownership check.

## Correction

The edit form opts into retaining the existing record during a token refresh. Its enclosing component is keyed by user id, full login identity and test id, so a different account, a new login for the same account, or another test still gets a fresh form. Other `useEnterpriseTest` consumers retain their original behavior. The existing save continuation guard remains active. No production dependency, API response, database schema or backend authorization changed.

The integration must retain the separate enterprise screen ownership patch (`b2226c0`) and the parent's `getNavigationVersion` props; this correction does not replace either.

## Executed evidence

The supplied probe bundles the actual `App`, `AuthProvider`, router, API client and form from each worktree. It simulates an input change and a cross-tab access-token rotation with the same user/session family/version, then holds the detail GET response. No real API request is sent.

| Observed input | Baseline `1011e35` | Corrected source |
| --- | --- | --- |
| Before token rotation | `unsaved title` | `unsaved title` |
| While refreshed GET waits | Form absent | `unsaved title` |
| After GET returns original record | `Private first exam` | `unsaved title` |

Baseline exits 1 because preservation fails; corrected source exits 0. Environment: Node `24.22.1`, JSDOM `31.0.1`, independent Front installs from the same lockfile. Raw outcomes and exact corrected source blob hashes are in [../measurements/phase2-enterprise-form-refresh.json](../measurements/phase2-enterprise-form-refresh.json).

Front `npm run check` passed (TypeScript, production build, answer-bundle privacy, 7 telemetry tests, browser-spec typecheck). All 10 CI policy cases passed. The new standalone `enterprise-refresh.spec.ts` discovers 5 scenarios / 15 Chromium, Firefox and WebKit instances: delayed normal refresh with multiple unsaved fields, account change, same-account new login, test-id change, and token refresh during save. Matching Firefox/WebKit core selection is included. Actual browser execution remains the exact combined CI gate; local Chromium startup was blocked by the workspace socket policy, so a DOM probe is not claimed as browser validation.

## Reproduction

Install Front dependencies independently in both source worktrees. Install the DOM substitute only in an owned temporary directory; the repository lockfile is unchanged.

```sh
FORM_PROBE_DIR="$(mktemp -d)"
npm install --prefix "$FORM_PROBE_DIR" --no-save --no-audit --no-fund jsdom@31.0.1
node docs/overhaul/repro/enterprise-form-refresh.mjs BASELINE_WORKTREE "$FORM_PROBE_DIR" before
node docs/overhaul/repro/enterprise-form-refresh.mjs CORRECTED_WORKTREE "$FORM_PROBE_DIR" after
```

The probe writes bundled source and JSON into that directory. It stubs browser primitives and has no layout, focus, engine-compatibility or real-server coverage. Independent review and final-HEAD CI must be recorded by the coordinator before integration.
