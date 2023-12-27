/*
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/
'use strict';

gLogContext = 'BG';

const kMARKED_AS_MAIN_WINDOW = 'marked-as-main-window';
const kMARKED                = 'true';

const gValues = new SessionValues();
gValues.defineItem('markedMainWindowId', browser.windows.WINDOW_ID_NONE);
gValues.defineItem('openingTabs', []);
gValues.defineItem('creatingTabs', new Set());
gValues.defineItem('trackedWindows', new Set());
gValues.defineItem('initialTabIdsInWindow', new Map(),
                   value => [...value.entries()].map(([key, value]) => [key, value && [...value]]),
                   value => new Map(value.map(([key, value]) => [key, new Set(value)])));
gValues.defineItem('anyWindowHasFocus', true);
gValues.defineItem('createdAt', new Map());
gValues.defineItem('lastActive', new Map());
gValues.defineItem('lsatCreatedAt', 0);

let gAggregateTabsMatchedPattern = null;
let gAggregateTabsFromMatchedPattern = null;
let gDoNotAggregateTabsMatchedPattern = null;
let gDoNotAggregateTabsFromMatchedPattern = null;

configs.$loaded.then(() => {
  updateAggregateTabsMatchedPattern();
  updateAggregateTabsFromMatchedPattern();
  updateDoNotAggregateTabsMatchedPattern();
  updateDoNotAggregateTabsFromMatchedPattern();
});

configs.$addObserver(key => {
  switch (key) {
    case 'aggregateTabsMatchedPattern':
      updateAggregateTabsMatchedPattern();
      break;
    case 'aggregateTabsFromMatchedPattern':
      updateAggregateTabsFromMatchedPattern();
      break;
    case 'doNotAggregateTabsMatchedPattern':
      updateDoNotAggregateTabsMatchedPattern();
      break;
    case 'doNotAggregateTabsFromMatchedPattern':
      updateDoNotAggregateTabsFromMatchedPattern();
      break;
  }
});

Promise.all([
  browser.windows.getAll({ windowTypes: ['normal'] }),
  gValues.loadAll(),
]).then(async ([windows, loadedKeys]) => {
  console.log('resumed with values: ', loadedKeys);

  // resumed case: skip initialization process
  if (gValues.markedMainWindowId != browser.windows.WINDOW_ID_NONE) {
    await updateIconForBrowserTheme();
    return;
  }

  const now = Date.now();
  let mainWindow = null;
  await Promise.all(windows.map(async window => {
    gValues.trackedWindows.add(window.id);
    gValues.createdAt.set(window.id, now);
    const state = await browser.sessions.getWindowValue(window.id, kMARKED_AS_MAIN_WINDOW);
    if (state == kMARKED)
      mainWindow = window;
  }));
  gValues.save('trackedWindows', 'createdAt');
  await updateIconForBrowserTheme();
  if (mainWindow)
    await markWindowAsMain(mainWindow.id);
});


const ORIGINAL_ICON_FOR_STATE = {
  marked:  '/resources/pinned.svg',
  default: '/resources/unpinned.svg',
};
const ICON_FOR_STATE = JSON.parse(JSON.stringify(ORIGINAL_ICON_FOR_STATE));

async function markWindowAsMain(windowId) {
  gValues.markedMainWindowId = windowId;

  const windows = await browser.windows.getAll();
  await Promise.all(windows.map(async window => {
    if (window.id == gValues.markedMainWindowId)
      return Promise.all([
        browser.sessions.setWindowValue(window.id, kMARKED_AS_MAIN_WINDOW, kMARKED),
        browser.action.setTitle({
          windowId: window.id,
          title:    browser.i18n.getMessage('browserAction_active'),
        }),
        browser.action.setIcon({
          windowId: window.id,
          path:     { 16: ICON_FOR_STATE.marked },
        }),
      ]);
    else
      return clearMark(window.id);
  }));
}

async function clearMarks() {
  gValues.markedMainWindowId = browser.windows.WINDOW_ID_NONE;

  const windows = await browser.windows.getAll();
  await Promise.all(windows.map(window => clearMark(window.id)));
}

async function clearMark(windowId) {
  return Promise.all([
    browser.sessions.removeWindowValue(windowId, kMARKED_AS_MAIN_WINDOW),
    browser.action.setTitle({
      windowId: windowId,
      title:    browser.i18n.getMessage('browserAction_inactive'),
    }),
    browser.action.setIcon({
      windowId: windowId,
      path:     { 16: ICON_FOR_STATE.default },
    }),
  ]);
}

function onToolbarButtonClick(tab) {
  if (gValues.markedMainWindowId == tab.windowId)
    clearMarks();
  else
    markWindowAsMain(tab.windowId);
}
browser.action.onClicked.addListener(onToolbarButtonClick);


const mDarkModeMatchMedia = window.matchMedia('(prefers-color-scheme: dark)');

async function updateIconForBrowserTheme(theme) {
  // generate icons with theme specific color
  if (!theme) {
    const window = await browser.windows.getLastFocused();
    theme = await browser.theme.getCurrent(window.id);
  }

  log('updateIconForBrowserTheme: ', theme);
  if (theme.colors) {
    const actionIconColor = theme.colors.icons || theme.colors.toolbar_text || theme.colors.tab_text || theme.colors.tab_background_text || theme.colors.bookmark_text || theme.colors.textcolor;
    log(' => ', { actionIconColor }, theme.colors);
    await Promise.all(Array.from(Object.entries(ORIGINAL_ICON_FOR_STATE), async ([state, url]) => {
      const response = await fetch(url);
      const body = await response.text();
      const actionIconSource = body.replace(/transparent\s*\/\*\s*TO BE REPLACED WITH THEME COLOR\s*\*\//g, actionIconColor);
      ICON_FOR_STATE[state] = `data:image/svg+xml,${escape(actionIconSource)}#toolbar-theme`;
    }));
  }
  else {
    for (const [state, url] of Object.entries(ORIGINAL_ICON_FOR_STATE)) {
      ICON_FOR_STATE[state] = `${url}#toolbar`;
    }
  }

  log('updateIconForBrowserTheme: applying icons: ', ICON_FOR_STATE);

  if (gValues.markedMainWindowId == browser.windows.WINDOW_ID_NONE)
    clearMarks();
  else
    await markWindowAsMain(gValues.markedMainWindowId);
}

browser.theme.onUpdated.addListener(updateInfo => {
  updateIconForBrowserTheme(updateInfo.theme);
});

mDarkModeMatchMedia.addListener(async _event => {
  updateIconForBrowserTheme();
});



function updateAggregateTabsMatchedPattern() {
  try {
    const source = (configs.aggregateTabsMatchedPattern || '').trim();
    gAggregateTabsMatchedPattern = source && new RegExp(source, 'i');
  }
  catch(_e) {
    gAggregateTabsMatchedPattern = null;
  }
}

function updateAggregateTabsFromMatchedPattern() {
  try {
    const source = (configs.aggregateTabsFromMatchedPattern || '').trim();
    gAggregateTabsFromMatchedPattern = source && new RegExp(source, 'i');
  }
  catch(_e) {
    gAggregateTabsFromMatchedPattern = null;
  }
}

function updateDoNotAggregateTabsMatchedPattern() {
  try {
    const source = (configs.doNotAggregateTabsMatchedPattern || '').trim();
    gDoNotAggregateTabsMatchedPattern = source && new RegExp(source, 'i');
  }
  catch(_e) {
    gDoNotAggregateTabsMatchedPattern = null;
  }
}

function updateDoNotAggregateTabsFromMatchedPattern() {
  try {
    const source = (configs.doNotAggregateTabsFromMatchedPattern || '').trim();
    gDoNotAggregateTabsFromMatchedPattern = source && new RegExp(source, 'i');
  }
  catch(_e) {
    gDoNotAggregateTabsFromMatchedPattern = null;
  }
}


const kPERSISTENT_ID = 'persistent-id';

function handleMissingTabError(error) {
  if (!error ||
      !error.message ||
      error.message.indexOf('Invalid tab ID:') != 0)
    throw error;
  // otherwise, this error is caused from a tab already closed.
  // we just ignore it.
  //console.log('Invalid Tab ID error on: ' + error.stack);
}

async function getUniqueTabId(tabId) {
  let originalId    = null;
  let originalTabId = null;
  let duplicated    = false;

  let oldId = await browser.sessions.getTabValue(tabId, kPERSISTENT_ID);
  if (oldId && !oldId.tabId) // ignore broken information!
    oldId = null;

  if (oldId) {
    // If the tab detected from stored tabId is different, it is duplicated tab.
    try {
      const tabWithOldId = await browser.tabs.get(oldId.tabId);
      if (!tabWithOldId)
        throw new Error(`Invalid tab ID: ${oldId.tabId}`);
      originalId = await browser.sessions.getTabValue(oldId.tabId, kPERSISTENT_ID);
      originalId = originalId && originalId.id;
      duplicated = tabWithOldId.id != tabId && originalId == oldId.id;
      if (duplicated)
        originalTabId = oldId.tabId;
      else
        throw new Error(`Invalid tab ID: ${oldId.tabId}`);
    }
    catch(e) {
      handleMissingTabError(e);
      // It fails if the tab doesn't exist.
      // There is no live tab for the tabId, thus
      // this seems to be a tab restored from session.
      // We need to update the related tab id.
      await browser.sessions.setTabValue(tabId, kPERSISTENT_ID, {
        id: oldId.id,
        tabId
      });
      return {
        id:            oldId.id,
        originalId:    null,
        originalTabId: oldId.tabId,
        restored:      true
      };
    }
  }

  const randomValue = Math.floor(Math.random() * 1000);
  const id          = `tab-${Date.now()}-${randomValue}`;
  // tabId is for detecttion of duplicated tabs
  await browser.sessions.setTabValue(tabId, kPERSISTENT_ID, { id, tabId });
  return { id, originalId, originalTabId, duplicated };
}


browser.tabs.onCreated.addListener(async newTab => {
  const isNewWindow = !gValues.trackedWindows.has(newTab.windowId);
  const now = Date.now();
  const deltaFromWindowCreated = now - (gValues.createdAt.get(newTab.windowId) || now);
  const initialTab = isNewWindow || deltaFromWindowCreated < configs.delayForNewWindow;
  const mayFromExternalApp = !gValues.anyWindowHasFocus;

  log('onCreated: tab: ', newTab, { isNewWindow, deltaFromWindowCreated, initialTab });

  if (initialTab) {
    const initialTabIds = gValues.initialTabIdsInWindow.get(newTab.windowId) || new Set();
    initialTabIds.add(newTab.id);
    gValues.initialTabIdsInWindow.set(newTab.windowId, initialTabIds);
    gValues.save('initialTabIdsInWindow');
  }

  gValues.trackedWindows.add(newTab.windowId);
  gValues.creatingTabs.add(newTab.id);
  gValues.save('trackedWindows', 'creatingTabs');
  let retryCount = 0;
  setTimeout(async function delayedOnCreated() {
    const tab = await browser.tabs.get(newTab.id);
    log(`delayedOnCreated ${retryCount} `, tab);
    if (!gValues.creatingTabs.has(newTab.id) ||
        tab.url != newTab.url ||
        tab.status != 'complete' ||
        initialTab)
      return;
    if (tab.url == 'about:blank' &&
        retryCount++ < 10) {
      setTimeout(delayedOnCreated, 100);
      return;
    }
    gValues.creatingTabs.delete(newTab.id);
    gValues.save('creatingTabs');
    log('delayed onCreated: tab: ', tab);
    tryAggregateTab(tab, {
      excludeLastTab: true,
      mayFromExternalApp,
    });
  }, 100);

  gValues.openingTabs.push(newTab.id);
  await wait(configs.delayForMultipleNewTabs);
  if (gValues.openingTabs.length > 1 &&
      Date.now() - gValues.lsatCreatedAt < configs.delayForNewWindow) {
    log(`tab ${newTab.id}: do nothing because multiple tabs are restored in an existing window`);
    await wait(100);
    gValues.openingTabs.splice(gValues.openingTabs.indexOf(newTab.id), 1);
    gValues.save('openingTabs');
    return;
  }
  gValues.openingTabs.splice(gValues.openingTabs.indexOf(newTab.id), 1);
  gValues.save('openingTabs');

  if (isNewWindow) {
    log('ignore initial tab of a new window');
    return;
  }
  if (initialTab) {
    log(`tab ${newTab.id}: do nothing  because this window is opened with the tab explicitly (maybe a restored window)`);
    return;
  }

  const bookmarked = await isBookmarked(newTab);
  if (!bookmarked &&
      newTab.url == 'about:blank') {
    log('ignore loading tab');
    return;
  }

  tryAggregateTab(newTab, {
    excludeLastTab: true,
    bookmarked,
    mayFromExternalApp,
  });
});

browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
  const initialTabIds = gValues.initialTabIdsInWindow.get(removeInfo.windowId) || new Set();
  initialTabIds.delete(tabId);
  gValues.save('initialTabIdsInWindow');
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url)
    return;

  const initialTabIds = gValues.initialTabIdsInWindow.get(tab.windowId) || new Set();

  if (gValues.creatingTabs.has(tabId)) {
    log('onUpdated: ', tab, changeInfo, { initialTab: initialTabIds.has(tabId) });
    // New tab opened from command line is initially opened with "about:blank"
    // and loaded the requested URL after that. We need to ignore such a
    // "loading" or "complete" event.
    if ((changeInfo.status &&
         changeInfo.url == 'about:blank') ||
        initialTabIds.has(tabId))
      return;
    log('delayed onCreated (onUpdated): tab: ', tab);
    gValues.creatingTabs.delete(tabId);
    gValues.save('creatingTabs');
    tryAggregateTab(tab, {
      excludeLastTab: true,
    });
    return;
  }

  initialTabIds.delete(tabId);
  gValues.save('initialTabIdsInWindow')

  if (!configs.redirectLoadingInCurrentTab)
    return;

  log('checking for loading in an existing tab: ', { tab: tab, changeInfo: changeInfo });

  if (!tab.active) {
    log(' => ignore loading in a background tab');
    return;
  }

  const [window, mainWindow] = await Promise.all([
    browser.windows.get(tab.windowId),
    getRedirectTargetWindowForTab(tab),
  ]);

  if (!mainWindow) {
    log(' => fatal: no main window!');
    return;
  }

  log(`tab ${tab.id}: window.width = ${window.width}`);
  if (window.width >= configs.redirectLoadingInCurrentTabMinWindowWidth) {
    log(` => ignore loading in a window larger than ${configs.redirectLoadingInCurrentTabMinWindowWidth}`);
    return;
  }

  log(` => aggregate to the window ${mainWindow.id}`);
  browser.tabs.create({
    url:      changeInfo.url,
    active:   true,
    index:    mainWindow.tabs.length,
    windowId: mainWindow.id
  });
});

browser.windows.onCreated.addListener(window => {
  const now = Date.now();
  gValues.createdAt.set(window.id, now);
  gValues.lastActive.set(window.id, now);
  gValues.lsatCreatedAt = now;
  gValues.save('createdAt', 'lastActive', 'lastCreatedAt');

  browser.sessions.getWindowValue(window.id, kMARKED_AS_MAIN_WINDOW)
    .then(value => {
      if (value == kMARKED)
        markWindowAsMain(window.id)
    });
});

browser.windows.onFocusChanged.addListener(windowId => {
  log(`windows.onFocusChanged: ${windowId}`);
  gValues.anyWindowHasFocus = windowId != browser.windows.WINDOW_ID_NONE;
  if (!gValues.anyWindowHasFocus)
    return;
  gValues.lastActive.set(windowId, Date.now());
  gValues.save('lastActive');
});

browser.windows.onRemoved.addListener(windowId => {
  gValues.createdAt.delete(windowId);
  gValues.lastActive.delete(windowId);
  gValues.trackedWindows.delete(windowId);
  gValues.initialTabIdsInWindow.delete(windowId);
  gValues.save('createdAt', 'lastActive', 'trackedWindows', 'initialTabIdsInWindow');
});

async function tryAggregateTab(tab, { bookmarked, mayFromExternalApp, ...options } = {}) {
  log('tryAggregateTab ', { tab, bookmarked, options });
  const shouldBeAggregated = await shouldAggregateTab(tab, {
    bookmarked,
    mayFromExternalApp,
  });
  if (!shouldBeAggregated)
    return;

  const mainWindow = await getRedirectTargetWindowForTab(tab, {
    excludeLastTab: true
  });
  if (!mainWindow)
    return;

  await browser.tabs.move([tab.id], {
    index:    mainWindow.tabs.length,
    windowId: mainWindow.id
  });
  browser.tabs.update(tab.id, { active: true });
}

async function shouldAggregateTab(tab, { bookmarked, fromExternalApp } = {}) {
  const opener = tab.openerTabId && await browser.tabs.get(tab.openerTabId);
  let shouldBeAggregated = null;
  if (opener) {
    log('shouldAggregateTab: has opener');
    if (opener.pinned) {
      shouldBeAggregated = configs.aggregateTabsFromPinned;
      log('pinned opener, should aggregate = ', shouldBeAggregated);
    }
    else {
      shouldBeAggregated = configs.aggregateTabsFromUnpinned;
      log('unpinned opener, should aggregate = ', shouldBeAggregated);
    }

    if (configs.aggregateTabsFromMatched) {
      if (gAggregateTabsFromMatchedPattern &&
          gAggregateTabsFromMatchedPattern.test(opener.url))
        shouldBeAggregated = true;
      log('matched opener, should aggregate = ', { shouldBeAggregated, gAggregateTabsFromMatchedPattern, url: opener.url });
    }
    if (configs.doNotAggregateTabsFromMatched) {
      if (gDoNotAggregateTabsFromMatchedPattern &&
          gDoNotAggregateTabsFromMatchedPattern.test(opener.url))
        shouldBeAggregated = false;
      log('matched opener for exception, should aggregate = ', { shouldBeAggregated, gDoNotAggregateTabsFromMatchedPattern, url: opener.url });
    }
  }

  if (configs.aggregateTabsMatched) {
    if (gAggregateTabsMatchedPattern &&
        gAggregateTabsMatchedPattern.test(tab.url))
      shouldBeAggregated = true;
    log('matched tab, should aggregate = ', { shouldBeAggregated, gAggregateTabsMatchedPattern, url: tab.url });
  }
  if (configs.doNotAggregateTabsMatched) {
    if (gDoNotAggregateTabsMatchedPattern &&
        gDoNotAggregateTabsMatchedPattern.test(tab.url))
      shouldBeAggregated = false;
    log('matched tab for exception, should aggregate = ', { shouldBeAggregated, gDoNotAggregateTabsMatchedPattern, url: tab.url });
  }

  if (bookmarked === undefined ? (await isBookmarked(tab)) : bookmarked) {
    shouldBeAggregated = configs.aggregateTabsForBookmarked;
    log('bookmarked url, should aggregate = ', { shouldBeAggregated, url: tab.url });
  }

  if (configs.aggregateTabsFromExternalApp &&
      fromExternalApp) {
    log('tab from external app, should aggregate');
    shouldBeAggregated = true;
  }

  if (shouldBeAggregated &&
      (!configs.aggregateDuplicatedTabs ||
       !configs.aggregateRestoredTabs)) {
    const uniqueId = await getUniqueTabId(tab.id);
    if (uniqueId.duplicated &&
        !configs.aggregateDuplicatedTabs) {
      log('do not aggregate duplicated tab');
      shouldBeAggregated = false;
    }
    if (uniqueId.restored &&
        !configs.aggregateRestoredTabs) {
      log('do not aggregate restored tab');
      shouldBeAggregated = false;
    }
  }

  if (shouldBeAggregated !== null)
    return shouldBeAggregated;

  log('default case, should aggregate = ', configs.aggregateTabsAll);
  return configs.aggregateTabsAll;
}

async function isBookmarked(tab) {
  try {
    const bookmarks = (await Promise.all([
      //browser.bookmarks.search({ url: tab.url }),
      (async () => {
        try {
          const bookmarks = await browser.bookmarks.search({ url: `http://${tab.title}` });
          return bookmarks;
        }
        catch(_e) {
        }
        return [];
      })(),
      (async () => {
        try {
          const bookmarks = await browser.bookmarks.search({ url: `https://${tab.title}` });
          return bookmarks;
        }
        catch(_e) {
        }
        return [];
      })()
    ])).flat();
    return bookmarks.length > 0;
  }
  catch(_e) {
  }
  return false;
}

async function getRedirectTargetWindowForTab(tab, options = {}) {
  log(`getRedirectTargetWindowForTab: id = ${tab.id}`, tab);

  const windows = (await browser.windows.getAll({
    populate:    true,
    windowTypes: ['normal']
  })).filter(window => window.incognito == tab.incognito);
  log('windows: ', windows);
  if (windows.length <= 1) {
    log('do nothing because there is only one window');
    return null;
  }

  const sourceWindow = windows.filter(window => window.id == tab.windowId)[0];
  log('sourceWindow: ', sourceWindow);
  if (options.excludeLastTab &&
      (!sourceWindow ||
       sourceWindow.tabs.length <= 1)) {
    log('do nothing because it is a new window');
    return null;
  }

  const mainWindow = findMainWindowFrom(windows);
  log('mainWindow: ', mainWindow.id);
  if (tab.windowId == mainWindow.id) {
    log('do nothing because it is the main window');
    return null;
  }
  return mainWindow;
}

const comparers = {
  wider:    (a, b) => b.width - a.width,
  taller:   (a, b) => b.height - a.height,
  larger:   (a, b) => (b.width * b.height) - (a.width * a.height),
  muchTabs: (a, b) => b.tabs.length - a.tabs.length,
  recent:   (a, b) => (gValues.lastActive.get(b) || 0) - (gValues.lastActive.get(a) || 0),
};

function findMainWindowFrom(windows) {
  const marked = windows.find(window => window.id == gValues.markedMainWindowId);
  if (marked) {
    log('findMainWindowFrom: marked as main: ', marked.id);
    return marked;
  }

  if (!configs.countPinnedTabsToDetectMainWindow) {
    for (const window of windows) {
      window.tabs = window.tabs.filter(tab => !tab.pinned);
    }
  }

  windows = windows.slice(0).sort((a, b) => {
    for (let name of configs.activeComparers) {
      const result = comparers[name](a, b);
      const acceptableFudgeFactor = configs.acceptableFudgeFactors[name] || 0;
      log('findMainWindowFrom: sorting ', { name, a: a.id, b: b.id, result, acceptableFudgeFactor });
      if (Math.abs(result) <= acceptableFudgeFactor)
        continue;
      if (result !== 0)
        return result;
    }
    return 0;
  });
  log('findMainWindowFrom: sorted windows: ', windows);
  return windows[0];
}
