# F-001 remediation record

## F-001: exclude E2E interfaces from packaged processes

1. Establish one main-process test-context policy requiring `!app.isPackaged` and explicit opt-in. Apply it to all E2E registration and test-handler capture sites, including `electron/ipcHandlers.ts:5604` and `:13682`.
2. Propagate the allowed test context through the main-owned synchronous boolean query, without importing the main-only `app` API into preload. Test that every BrowserWindow applies it consistently.
3. Replace generic test IPC passthrough with a narrow allowlist or named test methods. Production channels must be rejected even in an enabled development test session.
4. Keep the existing licensing, plan checks, and entitlements intact. The assessment has not established that their private/server controls fail.
5. Verify fresh electron-builder directory packages with `scripts/audit/verify-packaged-e2e.mjs`, in addition to development compatibility and the earlier packaged-state fixture. Dedicated macOS/Windows CI must pass before cross-platform acceptance; signed release verification remains separate.

Implemented: main registration and synthetic-handler capture use the shared packaged-state policy. A synchronous read-only query propagates main's boolean to the common preload, which exposes only the explicitly allowlisted test channels. Existing test-handler bodies, licensing and feature gates are unchanged.

## Changed files

- Runtime: `electron/services/e2eTestPolicy.ts`, `electron/ipcHandlers.ts`, `electron/preload.ts`, `src/types/electron.d.ts`.
- Regressions: `electron/services/__tests__/E2eTestPolicy.test.mjs`, `E2eInvokeGated2026_08_14.test.mjs`, `IpcBridgeWiring.test.mjs`.
- Probes: `scripts/audit/H-001-local-probe.mjs`, `local-security-bootstrap.cjs`, `F-117-repro.mjs`, `F-118-repro.mjs`. F-118 now calls existing `ragQueryLive`; F-117 expects production-channel rejection. The isolated harness uses existing `getMeetingActive` for its positive production-read control.
- Records: `FINDINGS.md`, `ADVERSARIAL_TEST_MATRIX.md`, `SECURITY_CONTROL_MAP.md`, `LESSON_SUMMARY.md`, this document.

The pre-existing public/free-build changes in `IntelligenceEngine.ts`, `resolveCompanySearchProvider.ts`, and its optional-Premium test were preserved, not modified by this remediation.

## Commands executed and results

- `npm run build:electron` — passed.
- `npm run typecheck:electron` — passed.
- `npm run typecheck:ts7` — renderer type-check passed.
- `node --test electron/services/__tests__/E2eTestPolicy.test.mjs electron/services/__tests__/E2eInvokeGated2026_08_14.test.mjs electron/services/__tests__/IpcBridgeWiring.test.mjs electron/services/__tests__/ResolveCompanySearchProviderOptionalPremium.test.mjs` — 16 passed.
- `node --test electron/services/__tests__/WindowsPlatformParity.test.mjs electron/services/__tests__/E2EParityEvidence.test.mjs` — 25 passed.
- `node scripts/audit/H-001-local-probe.mjs smoke` — actual npm start built renderer/Electron, opened a visible launcher, quit Electron normally, then stopped remaining npm/Vite processes; exit 0 on corrected harness.
- `node scripts/audit/H-001-local-probe.mjs development` — flag-off exclusion and flag-on read-only compatibility/production rejection passed; exit 0.
- `node scripts/audit/H-001-local-probe.mjs packaged` — actual packaged-state flag-off and two flag-on launches passed; exit 0. Ran after startup rebuilt assets.
- `node --check` on the four changed audit scripts — passed.
- `git diff --check`, `git status --short`, `git submodule status` — checked; no whitespace errors; private submodules remain uninitialized.

No lint command or ESLint configuration is present in the checkout; no dependency or ad-hoc lint configuration was added. Repository code-review-graph tools and CLI were unavailable; targeted caller/source inspection was used instead.

## Cross-platform status

- **Tested physically on macOS:** isolated startup, development fixtures, and real packaged-state Electron fixtures; every run shut down cleanly.
- **Build validated on macOS:** Electron build and npm start's renderer build.
- **Covered by automated macOS branch tests / Covered by automated Windows branch tests:** common bundled preload executed with both platform values and mocked IPC; policy/allowlist behavior and existing platform wiring checked.
- **Reviewed but not executed on Windows:** common IPC initialization and launcher, overlay, auxiliary, settings, model-selector, and cropper preload wiring are unchanged. No OS-specific production logic was added.
- **Requires physical Windows verification:** packaged flags 0/1, development compatibility, startup/shutdown. The existing copied-runtime fixture is macOS-only.
- **Requires physical macOS verification:** repeat against the actual signed/notarized release package, not just the temporary fixture.

F-001 is locally remediated, not cross-platform release-verified. No commits, pushes, paid operations, real credentials, external-service calls, or private-submodule initialization occurred.

## Remaining validation

The earlier copied-runtime fixture proves only the packaged condition in current code. The real-package results below supersede it for unsigned/ad-hoc macOS directory-package acceptance. Windows and signed release packages remain pending. Private source and hosted entitlement controls require their own authorised local fixtures before conclusions about paid functionality can be made.

## Real packaged-build verification — 2026-10-01

This phase changes only external verification, tests, CI and records. The application correction, licensing, private submodules, dependencies, signing configuration and existing release workflows are unchanged.

Added `scripts/audit/verify-packaged-e2e.mjs`, `scripts/__tests__/verify-packaged-e2e.test.mjs`, `scripts/__tests__/packaged-e2e-workflow.test.mjs`, and `.github/workflows/packaged-e2e-security.yml`. Extended only the external `local-security-bootstrap.cjs` to confirm exact packaged-entry interception, observe independent main/preload evidence, and support normal shutdown requests.

Electron disallows `NODE_OPTIONS=--require` in packaged applications ([Electron environment-variable documentation](https://www.electronjs.org/docs/latest/api/environment-variables)). The verifier therefore starts the unchanged executable paused with its existing loopback Node inspector, installs the external bootstrap before entry execution, then resumes. It does not flip fuses, modify ASAR/manifest/signatures, replace `app.isPackaged`, or replace the policy decision. A disabled inspect fuse, unknown initial pause, absent bootstrap confirmation, incomplete window render or unclean shutdown exits 2, never 0. A fully observed control regression exits 1. Normal shutdown precedes bounded, platform-specific cleanup of only the owned PID/tree. Manifest/entry links and unpacked entries are rejected rather than following workspace files.

### Exact local commands and outcomes

```sh
npm run build && npm run build:electron && npm run typecheck:electron && npm run build:native
node scripts/ensure-sharp-mac-deps.js && node scripts/ensure-napi-canvas-mac-deps.js && npm run verify:packaged-local-assets
node scripts/package-app.js --dir --mac --arm64 --publish never --config.directories.output="/var/folders/2w/5864_zbs0xs7307f3jt53ycm0000gn/T/natively-packaged-e2e.uJlgpt4Mmr"
node scripts/audit/verify-packaged-e2e.mjs --app "/var/folders/2w/5864_zbs0xs7307f3jt53ycm0000gn/T/natively-packaged-e2e.uJlgpt4Mmr/mac-arm64/Natively.app" --output "/var/folders/2w/5864_zbs0xs7307f3jt53ycm0000gn/T/natively-packaged-e2e.uJlgpt4Mmr/evidence-final"
node scripts/audit/H-001-local-probe.mjs smoke
node scripts/audit/H-001-local-probe.mjs development
npm run typecheck:electron && npm run typecheck:ts7
node --test scripts/__tests__/verify-packaged-e2e.test.mjs scripts/__tests__/packaged-e2e-workflow.test.mjs electron/services/__tests__/E2eTestPolicy.test.mjs electron/services/__tests__/E2eInvokeGated2026_08_14.test.mjs electron/services/__tests__/IpcBridgeWiring.test.mjs electron/services/__tests__/ResolveCompanySearchProviderOptionalPremium.test.mjs electron/services/__tests__/WindowsPlatformParity.test.mjs electron/services/__tests__/E2EParityEvidence.test.mjs
```

All passed. The final test command passed **63 tests**, including 22 new verifier/workflow tests and all four optional-Premium tests. Renderer/Electron builds, both type-checks and native preparation passed. The native build briefly emptied `native-module/index.d.ts`; its exact pre-existing contents were restored, leaving no declaration diff. Existing packaging collector warnings did not prevent packaging. The wrapper restored native addons; the subsequent real `npm start` rendered a visible launcher and quit Electron normally. Development flag-off has no bridge; flag-on preserves the harmless audit read, rejects production passthrough, and permits the existing named status API. No entitlement-seeding handler was called.

`node --check` passed for the verifier, bootstrap, both new test files and the three existing audit callers. Final `git diff --check` passed and `git status --short` was inspected; both private submodules remain uninitialized. No dependencies, commits, pushes or remote workflow runs were added/executed.

### Artifact and retained evidence

- Actual artifact: `/private/var/folders/2w/5864_zbs0xs7307f3jt53ycm0000gn/T/natively-packaged-e2e.uJlgpt4Mmr/mac-arm64/Natively.app` — Natively 2.8.8, Electron 43.1.0, electron-builder 26.8.1, macOS arm64 directory package, default ad-hoc signing (not Developer ID/notarized).
- Main entry: `Contents/Resources/app.asar/dist-electron/electron/main.js`, SHA-256 `95ad5e5e1077c45cdce81ef4ab9846520a6d79864c1dd3fe1dd154ee362ed19d`.
- Executable before/after SHA-256: `71824d67e146a92e47da9b692382c2eaf2f1a1cf59914336eaba9c56e88604ab`.
- ASAR before/after SHA-256: `c2fc62ae0f3d2deb38d3b598915039ac46d4c3b53c7b0536a09ed458c5aef9cb`.
- Packaged evidence: `/private/var/folders/2w/5864_zbs0xs7307f3jt53ycm0000gn/T/natively-packaged-e2e.uJlgpt4Mmr/evidence-final/results.json`. Its three distinct profile directories retain application logs and launcher PNGs.
- Post-package startup: `/private/var/folders/2w/5864_zbs0xs7307f3jt53ycm0000gn/T/natively-security-H001-CtsrmW/results.json`.
- Development compatibility: `/private/var/folders/2w/5864_zbs0xs7307f3jt53ycm0000gn/T/natively-security-H001-40BTPP/results.json`.

Flag 0, flag 1 and repeated flag 1 all reported real `app.isPackaged=true`, the exact packaged entry, zero test handlers, no synthetic capture, seven false policy replies, absent `e2eInvoke`, a visible rendered launcher, a screenshot, and normal exit 0. Packaged runs do not invoke any test or production handler. The initial harness preflight attempt used an unavailable fuse enum export and exited 2 before launch; it is excluded. Corrected debugger and final runs both passed. Temporary evidence is local and can be removed by the OS; CI uploads evidence for 14 days.

### CI and release gates

The new workflow has blocking `macos-latest` / `windows-latest` matrix jobs with `fail-fast: false`, public checkout without submodules/credentials, existing dependency install/model preparation, type-checks, focused regressions, builds and native preparation. It uses the existing packaging wrapper, `--dir`, host architecture and `--publish never`, preserving hooks/ABI restoration. Only the source asset preflight is used: its Darwin-specific packaged-native inventory is deliberately not applied to Windows. Evidence uploads even when an earlier build or verification step fails.

**CI outcome: not run. Windows outcome: not verified.** An authorized developer must submit these changes before CI executes; there was no commit, push or workflow dispatch. Cross-platform acceptance requires the Windows job actually to pass. Node inspector-disabled signed artifacts require a separately authorized verification method; no protections are weakened here. Signed/notarized macOS, Windows installers, other architectures, the complete native-feature inventory, and private/server entitlements remain separate release gates. The security skill informed fail-closed instrumentation, temporary-profile isolation and strict evidence classification, without expanding application scope.
