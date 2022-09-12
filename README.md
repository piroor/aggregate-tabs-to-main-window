# aggregate-tabs-to-main-window

![Build Status](https://github.com/piroor/aggregate-tabs-to-main-window/actions/workflows/main.yml/badge.svg?branch=trunk)

Aggregates new tabs to a window which has most many tabs and largest size.

* [Signed package on AMO](https://addons.mozilla.org/firefox/addon/aggregate-tabs-to-main-window/)
* [Development builds for each commit are available at "Artifacts" of the CI/CD action](https://github.com/piroor/aggregate-tabs-to-main-window/actions?query=workflow%3ACI%2FCD)

This addon will help you to use multiple windows with specific usages parallelly like: window 1 is for Twitter, window 2 is for main browsing. In such case, new tabs opened from Twitter will be moved to the main window automatically.

What is the "main browsing window"? This addon regards most largest window as that. If there are multiple largest windows, the tab which has most largest number of tabs is detected as the main. Moreover you can mark a specific window as the main window via the toolbar button.

## Useful example: parallel use of multiple sidebars, Tree Style Tab and Bookmarks

1. Go to `about:config` and set `browser.tabs.loadBookmarksInTabs` to `true`.
2. Show ["Tree Style Sidebar"](https://addons.mozilla.org/firefox/addon/tree-style-tab/) sidebar in the main window.
3. Open a new window, and show "Bookmarks" sidebar in the window.
4. Reduce width of the window for Bookmarks sidebar to enough width for the sidebar area.

If you cannot shrink the width of a browser window small, you need to use ["userChrome.css"](https://github.com/piroor/treestyletab/wiki/Code-snippets-for-custom-style-rules#on-firefox-69-and-later) to reduce minimum size of browser windows, for example:

```css
:root, #urlbar-container { min-width: 0 !important; }
```
