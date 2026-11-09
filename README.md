# AIWise — Claude account limits

The original AIWise menu with local Claude account names, confirmed free-message limits and reset countdowns. Bookmarks, Settings and Gemini keep their original interface. Tracking and the on-page usage widget are disabled.

- Source: `aiwise-patch/`
- Installed extension: `/home/home/Documents/AIWise-Free-Fix`

Rebuild the installed extension from the original local AIWise donor:

```sh
node aiwise-patch/apply.mjs
```

`AIWISE_DONOR` and `AIWISE_OUTPUT` can override the original donor and output paths. Existing unrelated folders cannot be overwritten. Original vendor files remain local; this repository contains the patch code.

Run checks:

```sh
node --test aiwise-patch/test/*.test.*
```

A reset time passing does not confirm restored access. Account/container behavior depends on Brave's session isolation.
