# Zatively — separate application identity

This public Natively fork is now Zatively. Original licensing, authorship,
Premium/API service names, entitlement checks, private-submodule boundaries,
optional-Premium fallback and packaged E2E policy are preserved.

## Identity and installation

`app.identity.json` is the shared public identity configuration:

- Product/executable: Zatively; npm package: zatively.
- Packaged bundle ID / Windows AppUserModelID: `io.github.riydomingo.zatively`.
- Development macOS bundle ID: `io.github.riydomingo.zatively.development`.
- macOS profile: `~/Library/Application Support/Zatively`.
- Windows profile: `%APPDATA%\Zatively`.
- Diagnostic log: `~/Documents/zatively_debug.log`.

Install the first Zatively package manually and configure it afresh. Profile
selection occurs before services capture their storage paths. Default profile
directories are created before selection; explicitly supplied harness/CLI
profiles and custom Chromium session directories are preserved. Natively's
settings, credentials, databases and model caches are not read or copied.
OS permission grants do not migrate; macOS may require fresh permission grants.
No TCC reset, credential migration or signing capability is fabricated.

The independent bundle ID gives Windows a separate NSIS installation identity
and macOS a separate bundle. This does not promise that both applications'
global shortcuts or optional services can run concurrently without port/resource
conflicts. Development and packaged builds still share Zatively's default profile;
use explicit isolated profiles during testing.

The update feed is `RiyDomingo/zatively-cluely-ai-assistant` (stable/latest).
Manual links and release tooling use Zatively artifact names. Automatic payload
acceptance rejects Natively-named artifacts, including already downloaded
metadata. The separate fork release workflow is the supported publication path;
legacy upstream workflows and the Drive-upload shortcut were not modified or run.
Signing, publication approval and actual two-version upgrade acceptance remain
required before updates are operational.

## Icon

The original assets remain untouched. New assets under `assets/zatively/`:
`icon-master.png`, `icon.png`, `icon.icns`, `icon.ico`, `iconTemplate.png`.
The white N monogram is rotated clockwise into a Z; the dark tile stays upright.
The inline SVG mark is rotated natively. Provider logos keep their existing
service identity. Internal compatibility identifiers and historical/help
references to Natively are not licensing or product-identity changes.

Built-in image-generation mode was used with the original `assets/icon.png`.
Final prompt:

> Use case: precise-object-edit. Edit target: supplied Natively app icon. Create
> the Zatively app icon by turning ONLY the white circular N monogram onto its
> side, 90 degrees clockwise, so it reads clearly as a capital Z. Preserve the
> rounded dark navy app tile, white ring, stroke proportions, original texture,
> blue edge glow, shading and centered layout. Keep the tile upright; only rotate
> the white mark inside it. Square 1024x1024 app-icon master, with genuinely
> transparent pixels outside the rounded square. Do not add any text, letters
> other than the resulting Z, decorative elements, perspective, mockup or watermark.

Rebuild packaging formats from the checked-in master with
`node scripts/build-zatively-icons.cjs`. Uses the existing Sharp dependency.

## Verification (2026-10-01)

- Electron and renderer type-checks: passed.
- `npm run build`, `npm run build:electron`: passed (existing bundle-size warning).
- Focused identity/update/free-build/E2E/package regressions: 82 passed.
- `npm run test:lifecycle-security`: 44 passed, 1 native Windows test skipped.
- Syntax checks and `git diff --check`: passed.
- Physically tested on macOS arm64: isolated development startup, visible
  launcher, restart, retained Vite and clean final quit; flag-off bridge absent.
  Evidence: `/private/tmp/zatively-identity-dev-20261001/restart.json` and its
  profile's `launcher-1.png`, `launcher-2.png`.
- Final post-package smoke: `node scripts/audit/verify-dev-restart.mjs /Users/riyaddomingo/.hermes/node/lib/node_modules/npm/bin/npm-cli.js /private/tmp/zatively-identity-dev-final-20261001 1`
  passed with allowlisted development calls and production-channel rejection.
  A final flag-off run at `/private/tmp/zatively-identity-dev-confirmed-20261001`
  also passed and independently recorded `appName: Zatively`, the unchanged
  temporary `userData` path, two visible windows across restart and clean quit.
  Its restart screenshot was visually inspected. Final source builds were
  completed by these startup smoke commands after native restoration.
- Fresh local package produced with
  `CSC_IDENTITY_AUTO_DISCOVERY=false node scripts/package-app.js --dir --mac --arm64 --publish never --config.directories.output=/private/tmp/zatively-identity-package-20261001`.
  Package: `/private/tmp/zatively-identity-package-20261001/mac-arm64/Zatively.app`.
  Plist confirms the packaged ID, Zatively name, icon and microphone description.
  Native ABI restoration completed.
- Packaged probe command:
  `node scripts/audit/verify-packaged-e2e.mjs --app /private/tmp/zatively-identity-package-20261001/mac-arm64/Zatively.app --output /private/tmp/zatively-identity-packaged-evidence-20261001`.
  **Incomplete (exit 2)**: all three launches confirmed external bootstrap and
  real packaged status but timed out before rendered-launcher evidence. Owned
  processes required forced cleanup. Executable/ASAR hashes were unchanged;
  hashes, source entry identity, profiles and logs are retained in `results.json`.
  This is not a packaged exclusion pass. Logs stop after credentials-manager
  initialization; the cause is not confirmed. That package predates the final
  default-directory preparation change (irrelevant to its explicit test profiles);
  it is not acceptance of the final release source.
- `codesign --verify --deep --strict <package>` fails with
  `a sealed resource is missing or invalid`, consistent with the previously
  documented post-sign native-resource change. No signing protection was weakened.

Windows identity/path branches are covered by automated Windows branch tests,
but require physical Windows verification. No Windows build, signed/notarized
release, real microphone capture, or signed upgrade is declared verified.
No new dependencies, private-submodule initialization, commits, pushes,
release publication or workflow dispatch.

## GitHub alignment follow-up

GitHub's API returned the same repository ID, `1351633811`, through both names,
with canonical `full_name: RiyDomingo/zatively-cluely-ai-assistant` and public
visibility. The rename was already effective; no repository mutation was needed.
Local origin was changed to the canonical URL; upstream remains the original
repository. No commit, push, remote workflow dispatch or release was performed.

Changes: `release.config.json`, default `package.json` publishing metadata,
fork-release workflow guards, README source/download/badge links, native-arch
reinstall messages (both CJS and ESM), matching tests and these records.
About/source/issues, release-note API and manual downloads inherit the shared
feed. Default publishing targets the fork as draft, not upstream as published.
Historical evidence and original-author attribution remain upstream references.

Expected macOS and Windows behavior: identical fork URLs; existing platform
packaging/signing hooks and licensing untouched. Impact is release discovery,
download guidance and CI repository identity checks, not permissions or features.
`Covered by automated macOS branch tests` and `Covered by automated Windows branch tests`:
feed/signing/configuration regressions included both branches; 40 focused tests
passed after rebuilding stale Electron output. Commands: `node --test` with
fork-release, app-identity, nativeArchParity, ReleaseNotesManager and
packaged-e2e-workflow tests; `npm run typecheck:electron`, `npm run typecheck:ts7`,
`npm run build`, `npm run build:electron`, `git diff --check`, `git status --short`.
`Reviewed but not executed on Windows`: actual GitHub-feed downloads and Windows
installation. `Requires physical Windows verification` remains unchanged.
Previously documented packaged startup/signature blockers are not resolved by
the repository rename. Test publication uses mocked requests, not GitHub writes.
