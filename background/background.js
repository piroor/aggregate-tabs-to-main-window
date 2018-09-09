/*
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/
'use strict';

gLogContext = 'BG';

const gOpeningTabs = [];

let gAggregateTabsMatchedPattern = null;
let gAggregateTabsFromMatchedPattern = null;

configs.$loaded.then(() => {
  updateAggregateTabsMatchedPattern();
  updateAggregateTabsFromMatchedPattern();
});

configs.$addObserver(key => {
  switch (key) {
    case 'aggregateTabsMatchedPattern':
      updateAggregateTabsMatchedPattern();
      break;
    case 'aggregateTabsFromMatchedPattern':
      updateAggregateTabsFromMatchedPattern();
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


browser.tabs.onCreated.addListener(async aTab => {
  log('onCreated: tab: ', aTab);

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
});

browser.tabs.onUpdated.addListener(async (aTabId, aChangeInfo, aTab) => {
  if (!configs.redirectLoadingInCurrentTab ||
      !aChangeInfo.url ||
      !aTab.active)
    return;

  log(`tab ${aTab.id}: window.width = ${window.width}`);
  if (window.width >= configs.redirectLoadingInCurrentTabMinWindowWidth)
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

async function shouldAggregateTab(aTab) {
  const opener = aTab.openerTabId && await browser.tabs.get(aTab.openerTabId);
  let shouldBeAggregated = null;
  if (opener) {
    if (opener.pinned) {
      shouldBeAggregated = configs.aggregateTabsFromPinned;
    }
    else {
      shouldBeAggregated = configs.aggregateTabsFromUnpinned;
    }

    if (gAggregateTabsFromMatchedPattern) {
      const matched = gAggregateTabsFromMatchedPattern.test(opener.url);
      if (configs.aggregateTabsFromMatched == matched)
          shouldBeAggregated = matched;
    }
  }

  /*
  if (gAggregateTabsMatchedPattern) {
    const matched = gAggregateTabsMatchedPattern.test(aTab.url);
    if (configs.aggregateTabsMatched == matched)
        shouldBeAggregated = matched;
  }

  if (configs.aggregateTabsForBookmarked)
    shouldBeAggregated = (await browser.bookmarks.search({ url: aTab.url })).length > 0;
  */

  if (shouldBeAggregated !== null)
    return shouldBeAggregated;

  return configs.aggregateTabsAll;
}


async function getRedirectTargetWindowForTab(aTab, aOptions = {}) {
  log(`getRedirectTargetWindowForTab: id = ${aTab.id}`, aTab);

  const shouldBeAggregated = await shouldAggregateTab(aTab);
  if (!shouldBeAggregated)
    return null;

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
