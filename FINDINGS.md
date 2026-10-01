# Initial security findings — 2026-10-01

Lifecycle follow-up: fresh macOS arm64 packaged exclusion passed again (flags 0/1/1, unchanged executable/ASAR hashes). Development restart and bridge compatibility passed. Harness readiness and Windows process ownership have focused regression coverage; physical Windows and signed upgrades remain pending. See [lifecycle verification](LIFECYCLE_VERIFICATION.md) for commands, artifacts, and unresolved microphone/signature observations. The ad-hoc package's strict signature failure is not release acceptance.

The first local campaign confirmed that the packaged-build E2E exclusion could be bypassed by launch environment and that the enabled bridge could invoke a production status channel. F-001 has now been remediated and verified against a fresh macOS arm64 electron-builder directory package; signed release packages and Windows execution remain pending. Paid-feature unlocking, licence forgery, server authorization, and destructive actions were not tested.

## F-001 — HIGH: packaged E2E interface enabled by launch environment

**Status: fixed in this checkout; independent main/preload checks passed against a real fresh macOS arm64 directory package. Windows CI and signed release-artifact verification required before release.** The evidence below preserves the original finding, followed by post-remediation results.

- **Affected controls:** C-02, C-04; hypotheses H-001 and the read-only part of H-002.
- **Classification:** 3 — Control can be bypassed. The proven boundary is exclusion of test interfaces from packaged processes.
- **Category:** feature-flag inconsistency and generic privileged-interface exposure.
- **Prerequisites:** ability to set the application's launch environment to `NATIVELY_E2E=1`; renderer execution or another means to call the exposed bridge. No unauthenticated remote attack was demonstrated.
- **Reproducibility:** two separate flag-on launches with separate empty test profiles produced identical results. A flag-off launch served as the negative control.
- **Original affected source (before remediation):** `electron/ipcHandlers.ts:13682` registered the test handlers based on the environment only; `electron/preload.ts:2755-2758` exposed an unrestricted `ipcRenderer.invoke` wrapper under that same condition.
- **Root cause:** launch environment is treated as sufficient proof of test context, despite `app.isPackaged` being available. The preload wrapper also accepts arbitrary channel names.
- **Impact established:** renderer access to a normally hidden read-only E2E handler and a production status handler in a packaged process. Privileged mutation handlers are in the same gated block, but their effects were not executed. The private Premium implementation and hosted backend are absent, so this evidence does not establish paid-feature or hosted-service access.
- **Severity rationale:** High because a shipped-process test boundary fails and the exposed interface is broader than its stated purpose. The earlier Critical hypothesis estimate is reduced to reflect local prerequisites and the impact actually demonstrated.

### Actual results

| Fixture launch | `app.isPackaged` | E2E environment | Renderer bridge | E2E audit read | Production status read | Shutdown |
|---|---|---|---|---|---|---|
| Negative control | true | 0 | undefined | Not invoked | Not invoked | Normal `app.quit()`, exit 0 |
| Reproduction 1 | true | 1 | function | success, empty audit | success, boolean | Normal `app.quit()`, exit 0 |
| Reproduction 2 | true | 1 | function | success, empty audit | success, boolean | Normal `app.quit()`, exit 0 |

Only `__e2e__:context-os-prompt-audit` and `get-meeting-active` were invoked. The former returns a redacted audit ring; the latter returns session status. No entitlement state was changed.

### Reproducible test

After building the renderer and Electron code, run:

```sh
node scripts/audit/H-001-local-probe.mjs packaged
```

The script creates a temporary copy of the installed macOS Electron runtime, renames the copied executable so Electron reports real `app.isPackaged=true`, and loads the current compiled public application through a test bootstrap. It does not override the `isPackaged` property. Three isolated profiles are used. External networking is blocked by the bootstrap. Exit 1 means the expected exclusion failed; exit 2 means the test was inconclusive. The original run failed; the post-remediation run passes with exit 0.

Evidence for the final conclusive run of the completed harness is retained at:

`/private/var/folders/2w/5864_zbs0xs7307f3jt53ycm0000gn/T/natively-security-H001-oejo07/results.json`

All three final runs reported a visible launcher and clean shutdown. Earlier attempts that raced the npm build's generated-file cleanup or checked React readiness too early were inconclusive; they are excluded from the classification. The completed harness polls renderer readiness. Run smoke and packaged modes sequentially because `npm start` rebuilds the shared output directories.

The fixture is not a signed/notarized release package. It references current workspace assets and modules; native-resource and auxiliary-window warnings therefore do not establish release defects. No Windows execution or actual release archive test was performed.

### Remediation and regression acceptance

Use a shared main-process decision requiring both an explicit test flag and `!app.isPackaged`, and propagate that trusted decision to the preload through a narrow mechanism supported by the existing Electron configuration. A preload cannot assume it can import `app`; verify the main/preload contract instead. Restrict test invocation to an explicit E2E channel allowlist, preferably named test methods. Keep test-only entitlement helpers outside shipped interfaces.

The regression must assert: packaged flag-off and flag-on runs both have no test bridge or registered test handler; development flag-off has no bridge; explicitly enabled development fixtures retain the intended test methods; a production channel is rejected by the test bridge. Repeat packaged cases on Windows before release.

## Startup validation

`node scripts/audit/H-001-local-probe.mjs smoke` runs the actual `npm start` workflow with a temporary profile and offline bootstrap, waits for the launcher to render, captures a screenshot, and asks Electron to quit normally. Remaining npm/Vite processes are terminated after Electron emits `will-quit`.

The successful visible-launcher run is recorded in:

`/private/var/folders/2w/5864_zbs0xs7307f3jt53ycm0000gn/T/natively-security-H001-tMlvjU/results.json`

It reported a visible launcher, nonempty React content, absent E2E bridge, and clean quit. The earlier harness-loading attempts were inconclusive and are not used as application failures or security evidence.

## Assessment coverage

Only the first prioritized campaign and its remediation regressions have been executed. All other matrix hypotheses remain pending. No entitlement, licensing, or private-module changes were made.

Final verification: the `npm start` workflow completed renderer and Electron builds; `npm run typecheck:electron`, all four optional-Premium regression tests, both harness syntax checks, and `git diff --check` passed. The packaged security probe exited 1 as designed because the exclusion assertion failed. No commits or pushes were made. Validation was performed on macOS Apple Silicon; Windows was not executed.

## Post-remediation verification — 2026-10-01

Main now computes `!app.isPackaged && NATIVELY_E2E === '1'` once during IPC initialization. A synchronous read-only policy query returns this boolean before window creation. The common preload exposes the bridge only for an exact `true` reply. Its explicit 21-channel test allowlist rejects production, unknown, and malformed channel names before invoking IPC. Existing test-handler bodies and entitlement checks are unchanged.

| Local launch | Packaged | Flag | Test handlers | Bridge | Synthetic handler | Result |
|---|---|---|---|---|---|---|
| Actual npm start | false | absent | none | absent | absent | visible launcher, clean quit |
| Development off | false | 0 | none | absent | absent | exit 0, clean quit |
| Development on | false | 1 | 21 listed channels | present | captured | read-only audit succeeds; production channel rejected; named status API succeeds; exit 0 |
| Packaged off | true | 0 | none | absent | absent | exit 0, clean quit |
| Packaged on, twice | true | 1 | none | absent | absent | both exit 0, clean quit |

The harness independently observes real main-process registration, synthetic capture, and policy assignments; it no longer infers registration from preload absence. Every observed preload query returned the expected boolean. The first smoke attempt had a harness-only readback error because Electron's `returnValue` is write-only; the corrected observer forwards and records the assignment unchanged. That attempt is excluded from acceptance evidence.

Evidence (temporary local files):

- Smoke: `/private/var/folders/2w/5864_zbs0xs7307f3jt53ycm0000gn/T/natively-security-H001-2i1o9d/results.json`
- Development: `/private/var/folders/2w/5864_zbs0xs7307f3jt53ycm0000gn/T/natively-security-H001-6pIqEM/results.json`
- Packaged: `/private/var/folders/2w/5864_zbs0xs7307f3jt53ycm0000gn/T/natively-security-H001-hOXLMP/results.json`

Build, Electron and renderer type-checks, 16 focused tests (including four optional-Premium tests), and 25 existing cross-platform/E2E wiring tests passed. Bundled-preload tests exercise `darwin` and `win32` values with mocked Electron IPC; these are not physical Windows execution. Syntax checks and final diff validation are recorded in `REMEDIATION_PLAN.md`. No mutation or entitlement-seeding handler was invoked.

## Fresh directory-package acceptance — 2026-10-01

The new `verify-packaged-e2e.mjs` launched the actual unchanged electron-builder Natively.app, not the copied Electron fixture. Three sequential, separate-profile runs (flag 0, flag 1, repeated flag 1) independently confirmed real packaged state, zero test registrations, no synthetic handler capture, false policy replies, absent bridge, visible rendered launcher, screenshots and normal exit 0. Executable and ASAR SHA-256 values were unchanged. The verifier requires pre-entry bootstrap confirmation and returns inconclusive exit 2 for unsupported instrumentation or incomplete startup/shutdown; it never relaxes package fuses or application policy.

Evidence: `/private/var/folders/2w/5864_zbs0xs7307f3jt53ycm0000gn/T/natively-packaged-e2e.uJlgpt4Mmr/evidence-final/results.json`. Exact artifact identity/hashes, commands and compatibility evidence are in `REMEDIATION_PLAN.md`. The post-package `npm start` smoke and development compatibility runs passed; 63 focused/existing parity tests and both type-checks passed. New CI covers fresh host-native macOS/Windows directory packages and retains failure evidence, but **has not run**. Windows is not declared verified. This does not establish signed/notarized release, Windows installer, other-architecture, complete native-feature or private/server authorization acceptance.
