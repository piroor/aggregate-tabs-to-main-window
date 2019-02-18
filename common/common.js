/*
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/
'use strict';

let configs;
let gLogContext = '?';

function log(message, ...args)
{
  if (!configs || !configs.debug)
    return;

  const nest = (new Error()).stack.split('\n').length;
  let indent = '';
  for (let i = 0; i < nest; i++) {
    indent += ' ';
  }
  console.log(`aggregate-tabs<${gLogContext}>: ${indent}${message}`, ...args);
}

function wait(delay) {
  return new Promise((resolve, reject) => setTimeout(resolve, delay));
}

configs = new Configs({
  activeComparers: ['wider', 'taller', 'muchTabs', 'recent'],
  aggregateTabsFromPinned: true,
  aggregateTabsFromUnpinned: true,
  aggregateTabsFromMatched: false,
  aggregateTabsFromMatchedPattern: '',
  aggregateTabsMatched: false,
  aggregateTabsMatchedPattern: '^(about:newtab)',
  doNotAggregateTabsFromMatched: false,
  doNotAggregateTabsFromMatchedPattern: '',
  doNotAggregateTabsMatched: false,
  doNotAggregateTabsMatchedPattern: '',
  aggregateTabsForBookmarked: true,
  aggregateDuplicatedTabs: false,
  aggregateRestoredTabs: false,
  aggregateTabsAll: true,
  redirectLoadingInCurrentTab: false,
  redirectLoadingInCurrentTabMinWindowWidth: 400,
  delayForMultipleNewTabs: 300,
  delayForNewWindow: 1000,
  debug: false
}, {
  localKeys: `
    debug
  `.trim().split('\n').map(key => key.trim()).filter(key => key && key.indexOf('//') != 0)
});
