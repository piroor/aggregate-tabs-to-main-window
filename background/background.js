/*
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/
'use strict';

gLogContext = 'BG';

const gOpeningTabs = [];
const gCreatingTabs = new Set();
const gTrackedWindows = new Set();

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
  log('onCreated: tab: ', newTab);

  const isNewWindow = gTrackedWindows.has(newTab.windowId);

  gTrackedWindows.add(newTab.windowId);
  gCreatingTabs.add(newTab.id);
  setTimeout(async () => {
    const tab = await browser.tabs.get(newTab.id);
    if (!gCreatingTabs.has(newTab.id) ||
        tab.url != newTab.url ||
        tab.status != 'complete' ||
        isNewWindow)
      return;
    gCreatingTabs.delete(newTab.id);
    log('delayed onCreated: tab: ', tab);
    tryAggregateTab(tab, {
      excludeLastTab: true
    });
  }, 100);

  gOpeningTabs.push(newTab.id);
  await wait(configs.delayForMultipleNewTabs);
  if (gOpeningTabs.length > 1 &&
      Date.now() - gLsatCreatedAt < configs.delayForNewWindow) {
    log(`tab ${newTab.id}: do nothing because multiple tabs are restored in an existing window`);
    await wait(100);
    gOpeningTabs.splice(gOpeningTabs.indexOf(newTab.id), 1);
    return;
  }
  gOpeningTabs.splice(gOpeningTabs.indexOf(newTab.id), 1);

  if (Date.now() - gCreatedAt.get(newTab.windowId) < configs.delayForNewWindow) {
    log(`tab ${newTab.id}: do nothing  because this window is opened with the tab explicitly (maybe a restored window)`);
    return;
  }

  if (isNewWindow) {
    log('ignore initial tab of a new window');
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
    bookmarked
  });
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url)
    return;

  if (gCreatingTabs.has(tabId)) {
    // New tab opened from command line is initially opened with "about:blank"
    // and loaded the requested URL after that. We need to ignore such a
    // "complete" event.
    if (changeInfo.status == 'complete' &&
        changeInfo.url == 'about:blank')
      return;
    log('delayed onCreated (onUpdated): tab: ', tab);
    gCreatingTabs.delete(tabId);
    tryAggregateTab(tab, {
      excludeLastTab: true
    });
    return;
  }

  log('checking for loading in an existing tab: ', { tab: tab, changeInfo: changeInfo });
  log(`tab ${tab.id}: window.width = ${window.width}`);
  if (!tab.active ||
      !configs.redirectLoadingInCurrentTab ||
      window.width >= configs.redirectLoadingInCurrentTabMinWindowWidth)
    return;

  const mainWindow = await getRedirectTargetWindowForTab(tab);
  if (!mainWindow)
    return;

  browser.tabs.create({
    url:      changeInfo.url,
    active:   true,
    index:    mainWindow.tabs.length,
    windowId: mainWindow.id
  });
});

const gCreatedAt = new Map();
const gLastActive = new Map();
let gLsatCreatedAt = 0;

browser.windows.onCreated.addListener(window => {
  const now = Date.now();
  gCreatedAt.set(window.id, now);
  gLastActive.set(window.id, now);
  gLsatCreatedAt = now;
});

browser.windows.onFocusChanged.addListener(windowId => {
  gLastActive.set(windowId, Date.now());
});

browser.windows.onRemoved.addListener(windowId => {
  gCreatedAt.delete(windowId);
  gLastActive.delete(windowId);
  gTrackedWindows.delete(windowId);
});

async function tryAggregateTab(tab, { bookmarked, ...options } = {}) {
  log('tryAggregateTab ', { tab, bookmarked, options });
  const shouldBeAggregated = await shouldAggregateTab(tab, { bookmarked });
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

async function shouldAggregateTab(tab, { bookmarked } = {}) {
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
      sourceWindow &&
      sourceWindow.tabs.length <= 1) {
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
  recent:   (a, b) => (gLastActive.get(b) || 0) - (gLastActive.get(a) || 0),
};

function findMainWindowFrom(windows) {
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
