/*
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/
'use strict';

gLogContext = 'BG';

browser.tabs.onCreated.addListener(async aTab => {
  log('new tab: ', aTab);

  const windows = await browser.windows.getAll({
    populate:    true,
    windowTypes: ['normal']
  });
  log('windows: ', windows);
  if (windows.length <= 1) {
    log('do nothing because there is only one window');
    return;
  }

  const sourceWindow = windows.filter(aWindow => aWindow.id == aTab.windowId)[0];
  log('sourceWindow: ', sourceWindow);
  if (sourceWindow.tabs.length <= 1) {
    log('do nothing because it is a new window');
    return;
  }

  const mainWindow = findMainWindowFrom(windows);
  log('mainWindow: ', mainWindow.id);
  if (aTab.windowId == mainWindow.id) {
    log('do nothing because it is the main window');
    return;
  }

  await browser.tabs.move([aTab.id], {
    index:    mainWindow.tabs.length,
    windowId: mainWindow.id
  });
  browser.tabs.update(aTab.id, { active: true });
});

function findMainWindowFrom(aWindows) {
  const windows = aWindows.slice(0).sort((aA, aB) => {
    return (aB.width * aB.height) - (aA.width * aA.height) ||
           aB.tabs.length - aA.tabs.length;
  });
  log('findMainWindowFrom: sorted windows: ', windows);
  return windows[0];
}
