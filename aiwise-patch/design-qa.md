# Original AIWise menu patch — design QA

- Source visual truth: `/tmp/aiwise-original-menu.png`, rendered from the untouched installed AIWise 0.7.0 donor.
- Implementation: `/tmp/aiwise-original-fixed-menu-final.png`, rendered from the patched unpacked extension in a separate Brave profile.
- Full-view comparison: `/tmp/aiwise-donor-comparison-final.png` was opened with both captures in the same image.
- Source size: 315 × 204 pixels. Initial patched capture: 315 × 443 pixels. CSS width 315px; device scale factor 1; no image scaling. Height differs because two synthetic account rows intentionally replace the no-data content.
- State: dark theme, Claude tab selected. The source shows the unavailable-usage message; the implementation shows synthetic account observations. This is a bounded content change, not a claim that both data states are identical.

## Comparison

- Fonts/typography: original menu fonts, header weight, tab labels and sizes retained from the donor.
- Layout/spacing: original 315px width, 12px outer padding, header controls, tab spacing and radii retained. The first 90px containing the complete header and tabs has no pixel differences between captures (Pillow ImageChops comparison).
- Colors/tokens: original theme assets retained. Account content uses original `--aiwise-*` variables.
- Assets: original logo PNG and provider assets retained directly; no generated or approximated replacement assets.
- Copy: only the Claude data area changes. Account names, observed limit, reset time and unverified expiry are shown. Original Bookmarks, Settings, Gemini and Refresh controls remain.

## Iterations and checks

1. Initial adapter mounted outside the original padded wrapper and retained the old Claude no-data block. Corrected mounting to follow the original tab row, within the original wrapper, and hide the replaced Claude data area only on the Claude tab.
2. The progress helper was not included in the popup context. Added the shared helper before the adapter. Re-rendered and compared the combined captures; original header/tab pixels match exactly.
3. Runtime: original Settings button opens the original settings page; original Claude/Gemini tabs switch normally and the account area is hidden on Gemini. Both custom background message types return `{ok:true}` alongside the original handlers.
4. Original notification setting disabled: a confirmed-limit observation is saved without sending a notification. No consent record is written. Popup console check found no errors.
5. Original Bookmarks markup and handler are retained; OS side-panel opening and actual signed-in provider accounts were not exercised in this headless profile.

No remaining actionable P0/P1/P2 visual differences in the unchanged original menu surfaces. Added account content is the intended modification.

final result: passed
