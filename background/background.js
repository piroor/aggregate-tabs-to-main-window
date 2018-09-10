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


browser.tabs.onCreated.addListener(async aTab => {
  log('onCreated: tab: ', aTab);

  gCreatingTabs.add(aTab.id);
  setTimeout(async () => {
    const tab = await browser.tabs.get(aTab.id);
    if (!gCreatingTabs.has(aTab.id) ||
        tab.url != aTab.url ||
        tab.status != 'complete')
      return;
    gCreatingTabs.delete(aTab.id);
    log('delayed onCreated: tab: ', tab);
    tryAggregateTab(tab, {
      excludeLastTab: true
    });
  }, 100);

  gOpeningTabs.push(aTab.id);
  await wait(configs.delayForMultipleNewTabs);
  if (gOpeningTabs.length > 1 &&
      Date.now() - gLsatCreatedAt < configs.delayForNewWindow) {
    log(`tab ${aTab.id}: do nothing because multiple tabs are restored in an existing window`);
    await wait(100);
    gOpeningTabs.splice(gOpeningTabs.indexOf(aTab.id), 1);
    return;
  }
  gOpeningTabs.splice(gOpeningTabs.indexOf(aTab.id), 1);

  if (Date.now() - gCreatedAt.get(aTab.windowId) < configs.delayForNewWindow) {
    log(`tab ${aTab.id}: do nothing  because this window is opened with the tab explicitly (maybe a restored window)`);
    return;
  }

  if (aTab.url == 'about:blank') {
    log('ignore loading tab');
    return;
  }

  tryAggregateTab(aTab, {
    excludeLastTab: true
  });
});

browser.tabs.onUpdated.addListener(async (aTabId, aChangeInfo, aTab) => {
  if (!aChangeInfo.url)
    return;

  if (gCreatingTabs.has(aTabId)) {
    log('delayed onCreated (onUpdated): tab: ', aTab);
    gCreatingTabs.delete(aTabId);
    tryAggregateTab(aTab, {
      excludeLastTab: true
    });
    return;
  }

  log('checking for loading in an existing tab: ', { tab: aTab, changeInfo: aChangeInfo });
  log(`tab ${aTab.id}: window.width = ${window.width}`);
  if (!aTab.active ||
      !configs.redirectLoadingInCurrentTab ||
      window.width >= configs.redirectLoadingInCurrentTabMinWindowWidth)
    return;

  const mainWindow = await getRedirectTargetWindowForTab(aTab);
  if (!mainWindow)
    return;

  browser.tabs.create({
    url:      aChangeInfo.url,
    active:   true,
    index:    mainWindow.tabs.length,
    windowId: mainWindow.id
  });
});

const gCreatedAt = new Map();
const gLastActive = new Map();
let gLsatCreatedAt = 0;

browser.windows.onCreated.addListener(aWindow => {
  const now = Date.now();
  gCreatedAt.set(aWindow.id, now);
  gLastActive.set(aWindow.id, now);
  gLsatCreatedAt = now;
});

browser.windows.onFocusChanged.addListener(aWindowId => {
  gLastActive.set(aWindowId, Date.now());
});

browser.windows.onRemoved.addListener(aWindowId => {
  gCreatedAt.delete(aWindowId);
  gLastActive.delete(aWindowId);
});

async function tryAggregateTab(aTab, aOptions = {}) {
  log('tryAggregateTab ', { tab: aTab, options: aOptions });
  const shouldBeAggregated = await shouldAggregateTab(aTab);
  if (!shouldBeAggregated)
    return;

  const mainWindow = await getRedirectTargetWindowForTab(aTab, {
    excludeLastTab: true
  });
  if (!mainWindow)
    return;

  await browser.tabs.move([aTab.id], {
    index:    mainWindow.tabs.length,
    windowId: mainWindow.id
  });
  browser.tabs.update(aTab.id, { active: true });
}

async function shouldAggregateTab(aTab) {
  const opener = aTab.openerTabId && await browser.tabs.get(aTab.openerTabId);
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

    if (gAggregateTabsFromMatchedPattern) {
      if (configs.aggregateTabsFromMatched &&
          gAggregateTabsFromMatchedPattern.test(opener.url))
        shouldBeAggregated = true;
      log('matched opener, should aggregate = ', { shouldBeAggregated, gAggregateTabsFromMatchedPattern, url: opener.url });
    }
    if (gDoNotAggregateTabsFromMatchedPattern) {
      if (configs.doNotAggregateTabsFromMatched &&
          gDoNotAggregateTabsFromMatchedPattern.test(opener.url))
        shouldBeAggregated = false;
      log('matched opener for exception, should aggregate = ', { shouldBeAggregated, gDoNotAggregateTabsFromMatchedPattern, url: opener.url });
    }
  }

  if (gAggregateTabsMatchedPattern) {
    if (configs.aggregateTabsMatched &&
        gAggregateTabsMatchedPattern.test(aTab.url))
      shouldBeAggregated = true;
    log('matched tab, should aggregate = ', { shouldBeAggregated, gAggregateTabsMatchedPattern, url: aTab.url });
  }
  if (gDoNotAggregateTabsMatchedPattern) {
    if (configs.doNotAggregateTabsMatched &&
        gDoNotAggregateTabsMatchedPattern.test(aTab.url))
      shouldBeAggregated = false;
    log('matched tab for exception, should aggregate = ', { shouldBeAggregated, gDoNotAggregateTabsMatchedPattern, url: aTab.url });
  }

  /*
  if (configs.aggregateTabsForBookmarked)
    shouldBeAggregated = (await browser.bookmarks.search({ url: aTab.url })).length > 0;
  */

  if (shouldBeAggregated !== null)
    return shouldBeAggregated;

  log('default case, should aggregate = ', configs.aggregateTabsAll);
  return configs.aggregateTabsAll;
}

async function getRedirectTargetWindowForTab(aTab, aOptions = {}) {
  log(`getRedirectTargetWindowForTab: id = ${aTab.id}`, aTab);

  const windows = (await browser.windows.getAll({
    populate:    true,
    windowTypes: ['normal']
  })).filter(aWindow => aWindow.incognito == aTab.incognito);
  log('windows: ', windows);
  if (windows.length <= 1) {
    log('do nothing because there is only one window');
    return null;
  }

  const sourceWindow = windows.filter(aWindow => aWindow.id == aTab.windowId)[0];
  log('sourceWindow: ', sourceWindow);
  if (aOptions.excludeLastTab &&
      sourceWindow.tabs.length <= 1) {
    log('do nothing because it is a new window');
    return null;
  }

  const mainWindow = findMainWindowFrom(windows);
  log('mainWindow: ', mainWindow.id);
  if (aTab.windowId == mainWindow.id) {
    log('do nothing because it is the main window');
    return null;
  }
  return mainWindow;
}

const comparers = {
  wider:    (aA, aB) => aB.width - aA.width,
  taller:   (aA, aB) => aB.height - aA.height,
  larger:   (aA, aB) => (aB.width * aB.height) - (aA.width * aA.height),
  muchTabs: (aA, aB) => aB.tabs.length - aA.tabs.length,
  recent:   (aA, aB) => (gLastActive.get(aB) || 0) - (gLastActive.get(aA) || 0),
};

function findMainWindowFrom(aWindows) {
  const windows = aWindows.slice(0).sort((aA, aB) => {
    for (let name of configs.activeComparers) {
      const result = comparers[name](aA, aB);
      if (result !== 0)
        return result;
    }
    return 0;
  });
  log('findMainWindowFrom: sorted windows: ', windows);
  return windows[0];
}
