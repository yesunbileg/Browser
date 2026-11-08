# AIWise local donor patch

This workspace contains an authored patcher for the untouched AIWise 0.7.0 donor installed in Brave Profile 5. The patcher copies the local donor into `/home/home/Documents/AIWise-Donor-Staging` and applies small, guarded changes. It does not modify the installed extension or donor source.

Run from this directory:

```sh
node apply.mjs
```

Optional environment variables `AIWISE_DONOR` and `AIWISE_OUTPUT` select the donor and staging paths. The donor source must be locally available. The staging copy excludes Chrome's `_metadata`, removes the manifest `key` and `update_url` so unpacked loading uses the staging path's ID, and retains the original popup, styling, icons, settings, side panel, bookmark capture, Gemini support and background behavior.

The patch adds the existing local Claude account observer and local account records. It removes the page usage widget, adds a small account list to the existing popup, and keeps the list visible only while the original Claude tab is selected. The display reports observed account names and confirmed free-message limit banners; it does not infer quota or recovery. A reset time that has passed remains unverified.

The donor's analytics export is replaced with no-op methods; its popup page-view/auto-track tail is removed; and the worker no longer services its analytics port. The consent gate is bypassed while leaving the donor's consent record unset. This keeps the original popup usable without accepting its Sensor Tower data-use prompt. No content is written to the account's conversation page.

The original vendor bundles stay on your machine. This repository contains only the authored patch files. The output directory must be new or contain this patcher's marker; the patcher refuses to overwrite unrelated folders or the original donor.

Extension-page network access is restricted to the extension itself, Claude, and Gemini. Analytics initialization and hooks are disabled. The existing notification setting also controls confirmed-limit alerts.

## Checks

```sh
node --check apply.mjs
node --check patch/background.js
node --check patch/popup-account-area.js
node --test test/staging.test.mjs
```

The integration check inspects the generated staging copy for the donor UI, patch hooks, disabled telemetry and manifest changes. See `design-qa.md` for the browser comparison and runtime checks. Real account and container behavior still depends on the browser's session isolation.
