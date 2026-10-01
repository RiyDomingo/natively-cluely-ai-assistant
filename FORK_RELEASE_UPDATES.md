# Verified fork updates — release and acceptance record

Lifecycle/harness follow-up: see [LIFECYCLE_VERIFICATION.md](LIFECYCLE_VERIFICATION.md). Installation now awaits completed independent probe/screenshot evidence, and Windows verifier-owned jobs retain detached installers. Both CI matrices include regression coverage. Fresh local macOS startup exclusion passed, but the ad-hoc native-module resource seal fails strict signature verification; no signed release or actual two-version upgrade is accepted or published.

## Status and scope

Prepared for `RiyDomingo/natively-cluely-ai-assistant`, stable channel, first version
`2.8.9` / `v2.8.9`, upstream base `2.8.8`. Only macOS arm64 and Windows x64
are release targets. No credentials, releases, commits, pushes, or remote workflow
runs were created during implementation. Signing and real installed-upgrade
acceptance remain unverified until the owner supplies credentials and runs CI.

The sole fork feed definition is `release.config.json`. The updater, release
notes, download links, public packaging wrapper, and signed fork packaging use
it. Feed failure never redirects to upstream. Explicit legacy upstream packaging
configuration and upstream workflows remain unchanged; do not use them for fork
releases. The default `scripts/package-app.js` uses `electron-builder.public.cjs`.

Packaged applications check after 10 seconds and every 24 hours while open.
Manual and scheduled checks share one in-flight request. Quit clears timers;
offline errors are nonfatal. Development has no automatic checks; manual checks
use the fork. Existing named download/restart APIs remain user-controlled.
Unsigned macOS builds retain manual installation, not fabricated signing status.

The app ID, product name and profile location are unchanged. Install the first
verified fork package manually and do not run it alongside official Natively.
No automatic production-profile migration or copying is performed.

## Owner configuration required before release

Confirm distribution rights and public anonymous access to this repository.
Create a **protected** GitHub environment named `fork-release`: require trusted
reviewers, prevent self-approval, restrict deployments to protected `main`, and
restrict who can dispatch/modify release workflows. Merely referencing an
environment in YAML does not configure its protection rules.

Environment variables:

| Name | Value |
| --- | --- |
| `FORK_DISTRIBUTION_AUTHORIZED` | `true`, only after owner authorization |
| `FORK_MAC_IDENTITY` | Your exact Developer ID Application identity |
| `FORK_APPLE_TEAM_ID` | Your own matching ten-character Team ID |
| `FORK_NOTARY_KEY_ID` | Your App Store Connect notarization key ID |
| `FORK_NOTARY_ISSUER` | Your notarization issuer UUID |
| `FORK_WIN_PUBLISHER` | Exact Windows certificate publisher simple name |

Protected environment secrets:

- `FORK_MAC_CERT_BASE64`, `FORK_MAC_CERT_PASSWORD`: exported Developer ID P12.
- `FORK_NOTARY_KEY_BASE64`: Apple API `.p8` key.
- `FORK_WIN_CERT_BASE64`, `FORK_WIN_CERT_PASSWORD`: Windows code-signing P12.

Do not put keys/tokens in checked-in files or client binaries. CI materializes
keys under its temporary directory, restores the macOS keychain search list and
removes its own keys. No upstream Team ID or keychain-profile defaults are used.
Skip-notarization flags, disabled signing, missing keys, wrong identities,
unsigned artifacts or missing notarization fail the release gate. A private
feed blocks deployment; do not embed an access token to make it work.

## Release procedure

1. Review upstream changes as source changes. Preserve optional Premium fallback
   and F-001 exclusion. Update `package.json` and lockfile root versions together
   to a strictly higher numeric stable version, starting at `2.8.9`.
2. Have an authorized developer submit the reviewed changes to protected `main`.
   Manually dispatch **Verified fork release** with the exact checked-in version.
   Both jobs check out the same immutable dispatch SHA without private submodules.
3. Approve the protected environment. Read-only build jobs run builds, typechecks,
   security/free-build tests and native preparation; the packaging wrapper uses
   `--publish never` and restores native ABIs. Existing signed-upload/Drive
   shortcuts are not called.
4. macOS creates a signed/notarized updater ZIP plus signed/notarized/stapled DMG;
   Windows creates a signed NSIS installer. Verify platform signatures, expected
   publisher, updater manifest payload sizes/SHA-512 and retained file SHA-256.
   macOS tests the actual app extracted from the final updater ZIP; Windows tests
   the actual `win-unpacked` package. Both run three sequential isolated F-001
   launches, observing main registration separately from preload exposure.
5. Each job also packages a **synthetic older version of the same current source**
   in `release-baseline`. The disposable-CI-only upgrade harness installs it,
   seeds only a dark theme in a temporary profile, serves the verified target
   through a loopback-only feed, invokes the existing download API and the real
   installer, and relaunches under isolation. Target executable/ASAR hashes,
   actual theme state and F-001 exclusion must pass. It cannot use credentials,
   entitlement seeding or production profiles. Unsupported instrumentation or
   an incomplete installation blocks publication; signatures/fuses are not
   weakened. This baseline is an acceptance fixture, not the previous shipping
   release, and does not substitute for the rollout test below.
6. Only after **both** platforms succeed does the separate protected publication
   job receive release-write permission. It rechecks receipts and hashes, checks
   public feed access/version history, creates a draft, uploads accepted bytes,
   validates GitHub asset digests, pins the tag to the dispatch SHA, then publishes.
   Existing tags/releases/assets are never overwritten. A failed draft requires
   owner inspection; automation will not resume by replacing its assets.

Evidence is retained in `fork-evidence-darwin` / `fork-evidence-win32` CI artifacts:
logs, screenshots, package identity, source commit, verification/upgrade JSON and
file hashes. Shipping assets have separate accepted-artifact receipts. Retention
is 14 days; archive acceptance evidence before expiration. Failed releases stay
unpublished. Correct an already published defect with a newly verified higher
version, not downgrade or asset replacement.

## Rollout gates still required

Install the first verified fork package manually. Then test a subsequent higher
shipping-version update on physical macOS arm64 and Windows x64 systems before
declaring automatic updates operational. Test synthetic settings without real
credentials. The CI same-source baseline tests installer mechanics; actual
previous-release compatibility remains this separate gate. Signing credentials,
protected-environment setup, Windows execution and signed upgrade testing were
not available locally. Intel macOS, Windows arm64, portable builds and Linux are
outside scope. Private/server entitlement behavior remains unassessed.

## Local implementation evidence (2026-10-01)

- `npm run build`, `npm run build:electron`, `npm run typecheck:electron`,
  `npm run typecheck:ts7`, `npm run build:native`: passed. Native build regenerated
  an empty tracked declaration file; its original declarations were restored.
- 75 focused `node:test` cases passed across fork release/scheduler, existing
  updater/version/lifecycle, E2E policy/IPC, optional Premium and packaged verifier
  suites. Windows layout/policy tests are mocked, not physical Windows execution.
- New scripts/configurations passed `node --check`. Release-context preflight
  exits 1 outside authorized dispatch; signing preflight exits 1 with missing
  fork keys. Publication tests use a mock API, not real GitHub publishing.
- Real local macOS arm64 **ad-hoc**, not Developer-ID-signed, package `2.8.9`
  passed three sequential packaged launches (flags `0`, `1`, repeated `1`),
  independent main/preload exclusion, visible rendered startup and exit 0.
  Executable and ASAR hashes were unchanged. Its manifest explicitly has
  `nativelySigned: false`; unsigned builds cannot claim in-place Mac installation.
- Post-package `npm start` smoke passed: visible rendered launcher, isolated
  profile and normal Electron quit. Development flag-off/on probes passed;
  flag-on permitted only the harmless audit read and rejected production-channel
  passthrough. No entitlement-seeding handler was invoked.
- Signed-artifact and upgrade CLIs each returned status 2 with
  `Required signing setting missing: FORK_MAC_CERT_FILE` in an empty environment.
  No signing, installer or network publishing operation was attempted.
- Packaging emitted existing dependency-collector warnings about optional
  sqlite-vec packages and a Node shell deprecation; the wrapper completed and
  restored the development native ABI. No dependency repair/audit fix was run.

Exact local package/probe commands (package/probes executed sequentially):

```sh
node scripts/package-app.js --dir --mac --arm64 --publish never --config.directories.output=/private/tmp/natively-fork-package.2Zypyc6v/final-package
node scripts/audit/verify-packaged-e2e.mjs --app /private/tmp/natively-fork-package.2Zypyc6v/final-package/mac-arm64/Natively.app --output /private/tmp/natively-fork-package.2Zypyc6v/final-evidence
node scripts/audit/H-001-local-probe.mjs smoke
node scripts/audit/H-001-local-probe.mjs development
```

Evidence locations:

- Package: `/private/tmp/natively-fork-package.2Zypyc6v/final-package/mac-arm64/Natively.app`.
- Packaged results/logs/screenshots: `/private/tmp/natively-fork-package.2Zypyc6v/final-evidence`.
- Smoke: `/var/folders/2w/5864_zbs0xs7307f3jt53ycm0000gn/T/natively-security-H001-1rbOT0`.
- Development compatibility: `/var/folders/2w/5864_zbs0xs7307f3jt53ycm0000gn/T/natively-security-H001-eLL1pC`.
- Signing/upgrade blockers: `/private/tmp/natively-fork-package.2Zypyc6v/signing-blocked/artifacts.json`
  and `/private/tmp/natively-fork-package.2Zypyc6v/upgrade-blocked/upgrade.json`.
- Earlier incomplete probe evidence retained at `/private/tmp/natively-fork-package.2Zypyc6v/evidence`.
  It identified test instrumentation reloading main; the harness now observes the
  intercepted module exports directly. That run was inconclusive, never a pass.

Final package SHA-256 (before and after probes):

```text
executable ab33b209b555db878091070a28779c9d29a53203e943ab3a84b78d1cf79123f5
app.asar   19a4288e080e719f1bf3a7927efa3d806edd81c37111fb0a5c2521a79d642933
```

The local `--dir` target intentionally emits no updater ZIP/installer manifests;
those bytes, signatures and real two-version installation are **prepared but not
physically verified**. CI has not been dispatched and no Windows job has run.
Temporary evidence is not permanent storage; archive it before system cleanup.
