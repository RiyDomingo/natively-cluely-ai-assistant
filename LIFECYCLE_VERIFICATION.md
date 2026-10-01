# Lifecycle and permission remediation — 2026-10-01

## Implemented behavior

Development restart previously relaunched Electron while `concurrently --kill-others` stopped Vite, producing connection-refused errors and a black renderer. `npm start` now owns Vite and Electron separately. Named restart signals the parent, quits normally, then starts a replacement only after clean close; Vite survives. Normal quit, child/server failures and interruptions stop owned processes. macOS uses owned process groups; Windows requests Electron quit over parent IPC, then uses bounded exact-PID/tree cleanup. Unmanaged development restart rejects with instructions to use `npm start`. Packaged restart still relaunches, with normal shutdown. Lifecycle IPC does not authorize E2E or paid operations.

Both permission components show request/query/missing-bridge failures and re-read OS status after actions. Request permission retains its boolean API but rejects actual request errors rather than misreporting denial. Windows query exceptions reject instead of inventing `granted`; actual OS `unknown` policy is unchanged. The toaster no longer simulates OS mic revocation with a local toggle.

The external upgrade harness awaits independent main/preload observations and successful screenshot capture instead of a fixed sleep. Failure, premature quit, timeout, malformed evidence, or changed app/profile isolation prevents installation. Windows baseline installers and upgrade Electron are created suspended, assigned to a non-breakaway verifier-owned Job Object, then resumed. Detached descendants remain contained until completion. Bounded forced cleanup affects only that job; controller loss invokes kill-on-close. Elevated/shell installation paths, failed containment and forced cleanup are inconclusive, not passes.

No licensing, entitlements, private-module gates, signing configuration, publishing logic or upstream workflow was changed. No dependency addition, privacy reset, private checkout, commit, push or workflow dispatch occurred.

## Files and platform impact

- Application: `package.json`, `scripts/dev-app.mjs`, `electron/services/devRestart.ts`, `electron/ipcHandlers.ts`, `src/lib/permissionActions.mjs` and `.d.mts`, both onboarding permission components.
- External verification: `local-security-bootstrap.cjs`, `probe-readiness.cjs`, `upgrade-security-bootstrap.cjs`, `verify-fork-upgrade.mjs`, `verify-packaged-e2e.mjs`, `windows-job.mjs`, `windows-job.ps1`, `dev-restart-bootstrap.cjs`, `verify-dev-restart.mjs` under `scripts/audit/`.
- Tests: new `dev-app`, `permission-actions`, `upgrade-readiness`, `windows-job` tests; updated Windows mic query regression.
- Both existing fork-release and packaged-E2E CI matrices run `npm run test:lifecycle-security`, including real Windows Job Object execution on Windows. No remote job has run.
- Records: this document, `FINDINGS.md`, `REMEDIATION_PLAN.md`, `FORK_RELEASE_UPDATES.md`.

Impact is confined to development lifecycle, named permission handlers/callers, external acceptance harnesses and tests. Potential regressions are owned-process cleanup, permission errors previously hidden, and stricter refusal of unsupported installer execution. The React checklist informed focus-listener cleanup and accessible error alerts. Native preparation generated an empty tracked `native-module/index.d.ts`; its baseline contents were restored, retaining no native-source/type change.

## Executed commands and evidence

```sh
npm run build
npm run build:electron
npm run typecheck:electron
npm run typecheck:ts7
npm run build:native
node scripts/ensure-sharp-mac-deps.js
node scripts/ensure-napi-canvas-mac-deps.js
npm run verify:packaged-local-assets
npm run test:lifecycle-security
CSC_IDENTITY_AUTO_DISCOVERY=false node scripts/package-app.js --dir --mac --arm64 --publish never --config.directories.output=/private/tmp/natively-lifecycle-package.pXr794/final-package
node scripts/audit/verify-packaged-e2e.mjs --app /private/tmp/natively-lifecycle-package.pXr794/final-package/mac-arm64/Natively.app --output /private/tmp/natively-lifecycle-package.pXr794/evidence
node scripts/audit/verify-dev-restart.mjs /Users/riyaddomingo/.hermes/node/lib/node_modules/npm/bin/npm-cli.js
node scripts/audit/verify-dev-restart.mjs /Users/riyaddomingo/.hermes/node/lib/node_modules/npm/bin/npm-cli.js /private/tmp/natively-lifecycle-package.pXr794/post-package-development 1
```

Full focused regression command (includes existing updater, workflow, E2E and optional-Premium tests):

Final result: 120 tests, 119 passed, no failures, one native Windows execution test skipped on macOS. Log: `/private/tmp/natively-lifecycle-package.pXr794/focused-tests.log`.

```sh
node --test scripts/__tests__/dev-app.test.mjs scripts/__tests__/permission-actions.test.mjs scripts/__tests__/upgrade-readiness.test.mjs scripts/__tests__/windows-job.test.mjs scripts/__tests__/fork-release.test.mjs scripts/__tests__/verify-packaged-e2e.test.mjs scripts/__tests__/packaged-e2e-workflow.test.mjs electron/update/UpdateCheckScheduler.test.mjs electron/update/ReleaseNotesManager.test.mjs electron/update/UpdaterAndLifecycleIntegrity2026_08_18.test.mjs electron/update/AppState.isRealUpgrade.test.mjs electron/services/__tests__/E2eTestPolicy.test.mjs electron/services/__tests__/E2eInvokeGated2026_08_14.test.mjs electron/services/__tests__/IpcBridgeWiring.test.mjs electron/services/__tests__/ResolveCompanySearchProviderOptionalPremium.test.mjs electron/services/__tests__/WindowsMicPermissionQueried2026_08_18.test.mjs electron/services/__tests__/MicPermissionPolicy2026_08_22.test.mjs
```

`node --check` ran against the supervisor, restart smoke files, Windows adapter, readiness module, security bootstraps, packaged/upgrade verifiers and permission actions. Final checks: `git diff --check`, `git status --short`.

- Flag-off restart: `/var/folders/2w/5864_zbs0xs7307f3jt53ycm0000gn/T/natively-restart-wVRpKo/`. Two visible rendered launchers, screenshots, no E2E bridge, OS mic `granted`, clean exit 0 and Vite stopped.
- Post-package flag-on restart: `/private/tmp/natively-lifecycle-package.pXr794/post-package-development/`. Two visible launchers, harmless audit read, generic production invocation rejected, named production read succeeded, clean exit 0 and server stopped. Native ABI restoration confirmed by this physical run.
- Fresh actual package: `/private/tmp/natively-lifecycle-package.pXr794/final-package/mac-arm64/Natively.app`, version 2.8.9, Electron 43.1.0. Log: `/private/tmp/natively-lifecycle-package.pXr794/packaging.log`.
- Packaged evidence: `/private/tmp/natively-lifecycle-package.pXr794/evidence/results.json`, per-profile logs and screenshots. Sequential flags 0/1/1 all passed: real packaged state, zero test handlers, no synthetic capture, false policy replies, absent bridge, visible renderer, clean shutdown.
- Executable SHA-256: `c7e33d5e2d7ad5b3ea6c012a06fcd0063be13c2bd0f0aa1afbff21ba5ab991ce`; ASAR SHA-256: `eaa41915db7bd572aa3da2d73ded257b648f63f13cfd8f604cc1602c22022f35`. Both unchanged by verification. This is exact local-artifact evidence, not signed-release acceptance.

Initial sandbox startup could not bind localhost (`EPERM`); approved isolated GUI/loopback execution passed. One test run overlapped build cleanup and lost compiled modules; sequential completed-build reruns passed. Run builds and compiled-output tests sequentially.

## Unresolved microphone/signing observations

`PlistBuddy` and `codesign` inspection found:

- Development ID `com.github.Electron`, expected microphone usage description, linker/ad-hoc signature with no bound plist/sealed resources. Strict verification fails: `code has no resources but signature indicates they must be present`.
- Packaged ID `com.electron.meeting-notes`, expected usage description, `com.apple.security.device.audio-input=true`. Strict verification fails: `a sealed resource is missing or invalid`; verbose output identifies `Contents/Resources/app.asar.unpacked/native-module/index.darwin-arm64.node` as modified. Existing hooks re-sign that module after signing the outer bundle. Those hooks were left unchanged; this package is not release-ready.
- Read-only startup queries report mic `granted`. No recording was made. This neither explains the missing Privacy entry nor proves the development plist patch caused a TCC failure. No privacy database reset or speculative signing repair was attempted.

Signed upgrade preflight returned 2 before installation, with missing `FORK_MAC_CERT_FILE`:

```sh
node scripts/audit/verify-fork-upgrade.mjs /private/tmp/natively-lifecycle-package.pXr794/baseline-not-provided /private/tmp/natively-lifecycle-package.pXr794/target-not-provided /private/tmp/natively-lifecycle-package.pXr794/signed-upgrade-preflight
```

Targeted ESLint could not run: installed ESLint 10 lacks repository `eslint.config.*`. No unrelated lint setup was added. Existing chunk-size and dependency-collector warnings remain.

## Acceptance categories

- **Tested physically on macOS:** development restart, flag-off/on compatibility, real packaged startup/E2E exclusion, screenshots and normal shutdown.
- **Build validated on macOS:** renderer, Electron, native assets and directory package.
- **Covered by automated macOS branch tests:** lifecycle policy, permission remedies/errors, readiness races/failures and packaged policy.
- **Covered by automated Windows branch tests:** permission remedies/errors, cleanup decisions, job receipts/timeout/ownership failures and upgrade readiness.
- **Reviewed but not executed on Windows:** actual suspended launch/Job Object inheritance, development restart, NSIS containment, signing and installed upgrade. The native Windows job test is skipped locally and included in CI.
- **Requires physical macOS verification:** user-approved microphone recording/Privacy UI diagnosis and valid signed/notarized two-version upgrade.
- **Requires physical Windows verification:** native job test, development restart/microphone controls and signed NSIS two-version upgrade. No Windows/remote CI success is claimed.

Microphone root cause and signature defects remain unresolved. F-001 startup exclusion is locally verified, but signed-release acceptance remains blocked. Keep incomplete releases unpublished.
