/*
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/
'use strict';

gLogContext = 'BG';

const gOpeningTabs = [];
const gCreatingTabs = new Set();

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

browser.tabs.onCreated.addListener(async newTab => {
  log('onCreated: tab: ', newTab);

  gCreatingTabs.add(newTab.id);
  setTimeout(async () => {
    const tab = await browser.tabs.get(newTab.id);
    if (!gCreatingTabs.has(newTab.id) ||
        tab.url != newTab.url ||
        tab.status != 'complete')
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

  if (newTab.url == 'about:blank') {
    log('ignore loading tab');
    return;
  }

  tryAggregateTab(newTab, {
    excludeLastTab: true
  });
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url)
    return;

  if (gCreatingTabs.has(tabId)) {
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
});

async function tryAggregateTab(tab, options = {}) {
  log('tryAggregateTab ', { tab, options });
  const shouldBeAggregated = await shouldAggregateTab(tab);
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

async function shouldAggregateTab(tab) {
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

  if (configs.aggregateTabsForBookmarked) {
    try {
      if ((await browser.bookmarks.search({ url: tab.url })).length > 0) {
        shouldBeAggregated = true;
        log('bookmarked url, should aggregate = ', { shouldBeAggregated, url: tab.url });
      }
    }
    catch(_e) {
    }
  }

  if (shouldBeAggregated !== null)
    return shouldBeAggregated;

  log('default case, should aggregate = ', configs.aggregateTabsAll);
  return configs.aggregateTabsAll;
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
      if (result !== 0)
        return result;
    }
    return 0;
  });
  log('findMainWindowFrom: sorted windows: ', windows);
  return windows[0];
}
