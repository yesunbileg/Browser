# AIWise local fix

Complete unpacked extension with the original AIWise menu, Bookmarks, Settings and Gemini interface. The Claude account tracker and local reset countdowns are included. Tracking and the on-page usage widget are disabled.

## Install

Open `brave://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the `AIWise` folder. No build or separate donor files are required.

The current local installation is `/home/home/Documents/AIWise-Free-Fix`. Account observations stay in Chrome extension storage, not in this repository.

## Test

```sh
node --test test/*.test.*
```

This checkpoint contains the complete current extension. The reset-time and performance review fixes are the next changes.
