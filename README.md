# AIWise local fix

Complete unpacked extension with the original AIWise menu, Bookmarks, Settings and Gemini interface. No build or separate donor files are required. Telemetry and the on-page usage widget are disabled; Claude account observations stay in local extension storage.

## Install

Open `brave://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `AIWise`. For an existing installation, update its existing folder and reload it to retain its extension ID and account records. Reload Claude tabs to activate updated content scripts.

The current local installation is `/home/home/Documents/AIWise-Free-Fix`.

## Claude Free tracking

- Each account is identified through its tab's authenticated `/api/account` response. Completion evidence must match that account's organization membership. Account records share the single `aiwise.accountRecords` key; older per-account records migrate once.
- Structured completion HTTP 429/SSE reset epochs take priority over DOM clock inference. Only bounded response clones are inspected; prompts and conversation contents are not logged or stored.
- The confirmed Free banner is a fallback, supporting English AM/PM and 24-hour clocks, including resets after midnight. DOM scans debounce for 300ms. Identity checks run on load, focus, visibility/navigation events and new evidence, without a periodic identity poll.
- States are `unknown`, `exhausted`, `likely_available`, and `available`. A reset alarm gives a deduplicated notice that messages **may** be available. Only a successful completion stream confirms `available`. Banner disappearance alone never proves availability.
- Countdown progress measures the observed cooldown, not remaining quota. Claude Free does not expose a reliable remaining-message total.
- A continuously stale banner retains its original reset. A banner that disappears and later reappears can start a new cycle. DOM-only clock dates remain inferred in the browser's local timezone; an epoch avoids that ambiguity.
- The popup adapter checks the pinned donor asset SHA256 values and extension version in `aiwise-patch/donor-lock.json`, showing an explicit error on mismatch. The original donor is AIWise 0.7.0, locally patched for privacy and account tracking.

## Verification

```sh
node --test test/*.test.*
```

Tests cover midnight/24-hour parsing, stale/new cycles, network payload parsing, account attribution, concurrent storage writes, alarms, notification deduplication and donor integrity failures. Network payload fixtures are synthetic: the live Claude 429 body has **not** yet been captured and verified. Unsupported response shapes fall back to the visible banner; do not interpret these tests as proof of Claude's undocumented schema.

For a real extension smoke test, launch a **disposable** Brave profile with only this extension:

```sh
brave --headless=new --no-sandbox --remote-debugging-port=19229 \
  --user-data-dir=/tmp/aiwise-smoke-profile \
  --disable-extensions-except="$PWD/AIWise" --load-extension="$PWD/AIWise" about:blank
playwriter session new --direct 127.0.0.1:19229 --tab-group aiwiseqa
playwriter -s SESSION_ID --timeout 20000 -f test/browser-smoke.playwriter.js
```

The smoke script refuses a profile without the canonical extension path or with additional extensions. It mocks Claude responses, then exercises the installed content scripts, worker, storage, original popup, a real Chrome alarm and reset notification. It never sends a real Claude message. The canonical path check assumes this checkout is `/home/home/Documents/Browser`.
