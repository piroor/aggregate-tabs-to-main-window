/*
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/
'use strict';

gLogContext = 'BG';

browser.tabs.onCreated.addListener(async aTab => {
  log('new tab: ', aTab);
  let windows = await browser.windows.getAll({
    populate:    true,
    windowTypes: ['normal']
  });
  log('windows: ', windows.length);
  if (windows.length <= 1)
    return;
  windows.sort((aA, aB) => {
    return (aB.width * aB.height) - (aA.width * aA.height) ||
           aB.tabs.length - aA.tabs.length;
  });
  log(' => ', windows);
  const targetWindow = windows[0];
  log('targetWindow: ', targetWindow.id);
  if (aTab.windowId != targetWindow.id) {
    await browser.tabs.move([aTab.id], {
      index:    targetWindow.tabs.length,
      windowId: targetWindow.id
    });
    browser.tabs.update(aTab.id, { active: true });
  }
});
