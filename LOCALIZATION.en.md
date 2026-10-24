# English UI validation — unreleased source

[简体中文](LOCALIZATION.zh-CN.md) · **English**

Baseline: `f3ea5afb365316c2bef145f8dab27bcee5163fd8` on the already pushed `fix/dsh-rc3-compatibility` branch. Work continues on `fix/english-localization` with manifest version `0.1.2`. On 2026-10-24, the public npm `latest` endpoint still reported `0.1.1`. This source update does not change any previously distributed tarball, npm package, or release.

The user explicitly authorized English localization, testing, and a scoped Git push on 2026-10-24. That authorization covers this implementation; promotional posts and package/release publication remain outside scope.

## Findings and acceptance

The documentation was already bilingual, but the plugin's own interface strings were hard-coded in Chinese. The existing screenshots show isolated 0.1.0 Chinese settings components; they are separate from the current source's language support.

| Requirement | Implementation and verification |
| --- | --- |
| LOC-01: Follow the host language and preserve Chinese | Register matching English/Chinese dictionaries with the existing dsh locale service. Subscribe per plugin instance; retain native host components and locale-aware composed pickers. Installed rc.2/rc.3 locale declarations match the service calls. |
| LOC-02: Cover settings, dialogs, and errors | Translate navigation, settings, PIN/recovery/backup, lock/unlock/workspace controls, public credential errors, preview placeholders, relative times, and accessibility labels. User-authored titles/messages remain untouched. |
| LOC-03: Keep pending forms and access behavior | Bilingual real-API tests exercise enrollment, backup confirmation/download/import, cancellation, PIN changes, recovery, window expiry, and lock removal. Locale changes preserve populated PIN/backup fields and visible errors without replaying verification. Two mounted locale scopes stay independent. |
| LOC-04: Localize standalone settings | Validate supported language tags; explicit `lang` query takes precedence over weighted browser `Accept-Language`, with English fallback. Test the actual registered route in an in-process plugin lifecycle fixture without a listener. Preserve existing response protections. |
| LOC-05: Preserve native behavior and credential data | Existing projection, native composition/picker/draft, credential, memory-isolation, and access-grant tests remain passing. No host source, persisted format, credential, or permission changes. |

## Review and automated validation

A separate review agent invoked as `gpt-6-astra` reviewed the requirements/test plan and implementation. Invocation metadata establishes the different model; the review did not return a more precise version. Findings about explicit error mappings, runtime language changes, instance isolation, literal interpolation, remaining UI surfaces, query validation, and untranslated diagnostics were addressed. No blocking implementation issue remained in that review.

- Node.js `24.19.0`: **77 tests passed** with installed rc.2 interfaces, then **77 passed** in a separate temporary source copy using rc.3 interfaces. Existing environments were not reconfigured.
- Typecheck and build passed in both interface environments.
- `npm pack --dry-run` passed: the package whitelist contains the build, manifest, patch, documentation, and license; it excludes runtime/profile data and credentials. No npm publication occurred.
- Existing compatibility evaluator passed against the installed rc.2 and rc.3 host packages, accepting only the declared host versions without exemptions.
- `git diff --check` passed. No lint script is configured.

DOM/component tests use adapted primitive controls and synthetic temporary credential stores. They are **not full host, desktop, browser, or installed-package acceptance**. Post-push commit and CI results are reported separately with the delivered commit.

## Screenshot and host limits

New screenshots were not captured. The earlier isolated host launch was denied with `listen EPERM` on `127.0.0.1`; it was not retried using another port, route, or permission. A static current-component preview was prepared without a listener, but the browser rejected its local `file:` URL: only HTTP/HTTPS protocols are allowed, and the policy explicitly prohibited workarounds. Native computer capture also reported the Mac locked. No attempt was made to unlock it, change browser permissions, or repurpose an existing DSH instance.

The original `assets/screenshots/01-settings.png`, `02-pin.png`, and `03-recovery.png` remain unchanged and explicitly labeled as isolated **0.1.0** demonstrations. They must not be presented as current English UI or end-to-end host evidence. No new screenshot file was saved to Library, and no Library file ID is claimed.

Remaining manual acceptance: run the current source in an explicitly permitted isolated rc.2/rc.3 host, check English/Chinese settings and lock/unlock/recovery visually, and capture accurately labeled English screenshots. This work does not claim that acceptance or change any running host/task.
