# Claude Account Limits

A small Brave/Chromium extension that lists observed Claude account names and free-message limit reset times in the toolbar popup. It reads the limit banner shown by Claude and does not display a panel on the page. Each limited account has a countdown and a non-editable time progress bar. The bar starts when the extension first detects the limit; it does not represent message quota. Older records without an observation start time show only the timer until a new limit is detected.

## Install

1. Open `brave://extensions`, enable **Developer mode**, and select **Load unpacked**.
2. Select this `claude-account-limits` folder. Pin the extension if you want to open its popup from the toolbar.
3. Open a Claude tab for each account. A tab must be open for the extension to observe that account. The popup retains the last observation; a passed reset time is **unverified**, not a guarantee of restored access.

The extension reads the account's identity from `claude.ai/api/account` and looks for Claude's visible English free-message limit banner. It stores account names, IDs and observations in extension-local storage. It does not record conversations or send data to a third-party service. Support for different Brave container extensions depends on their session isolation and has not been verified.

The Claude usage endpoint can return no free-plan quota data, so the extension does not estimate remaining messages or display an available status from the absence of a banner. It can only report a limit after observing the banner. Other Claude messages and languages are not yet supported.

## Tests

Run `node --test tests/*.test.cjs` with Node.js.
