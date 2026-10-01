# Lessons from the initial campaign

The E2E bridge was absent when its environment flag was off. That part of the control worked. The assumption that a packaged process could never receive the flag failed: a real packaged-mode Electron fixture exposed the bridge and handlers when the flag was on, in two separate launches.

The most effective tested category was a feature-flag inconsistency across trust boundaries. A related weakness was capability breadth: a generic test method accepted a production channel name. Context isolation does not compensate for a deliberately exposed privileged bridge.

The demonstrated impact is test-interface access, not paid-feature unlocking. Private Premium code and hosted authorization remain unavailable; no licence, trial, ingestion, deletion, or paid operation was exercised. An apparent interface exposure should not be inflated into untested business impact.

A shared packaged-build policy, a narrow preload contract, and regression tests against actual packaged processes would prevent this failure from recurring. Tests that only launch development Electron with `NODE_ENV=production` are insufficient because that does not itself make `app.isPackaged` true.

That correction is now implemented and locally verified: main owns the packaged-state decision, every common preload queries that decision, and the test bridge has an exact channel allowlist. Separate registration observation confirms the packaged handlers are absent, rather than merely hidden by preload. Development read-only test access survives while production-channel passthrough is rejected. Existing named production methods remain available.

Regression coverage includes packaged/unpackaged flag combinations, malformed channel rejection before IPC, exact allowlist/registration parity, preserved transport errors, and bundled-preload execution with both supported platform values. Windows and signed-release execution remain required before release. The security skill informed the main-process enforcement and narrow-capability tests; it did not broaden the fix into licensing or other untested findings.

The remaining controls have not yet been ranked as strongest or weakest by testing. Their hypotheses remain pending in the matrix.

The follow-up now tests a fresh, unchanged electron-builder macOS arm64 package rather than relying on a renamed runtime fixture. Startup interception must confirm the exact packaged entry before it resumes; unsupported inspection or incomplete evidence is inconclusive, never a pass. Independent main/preload observations, immutable executable/ASAR hashes, offline temporary profiles, visible UI and clean shutdown all passed. Dedicated macOS/Windows CI was added but not remotely executed. Windows and signed/notarized release verification remain separate gates. The security skill informed this isolation and fail-closed evidence handling, not any new application or licensing change.
