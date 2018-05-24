/*
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/
'use strict';

var configs;
var gLogContext = '?';

function log(aMessage, ...aArgs)
{
  if (!configs || !configs.debug)
    return;

  var nest   = (new Error()).stack.split('\n').length;
  var indent = '';
  for (let i = 0; i < nest; i++) {
    indent += ' ';
  }
  console.log(`aggregate-tabs<${gLogContext}>: ${indent}${aMessage}`, ...aArgs);
}

function wait(aDelay) {
  return new Promise((aResolve, aReject) => setTimeout(aResolve, aDelay));
}

configs = new Configs({
  activeComparers: ['wider', 'taller', 'muchTabs', 'recent'],
  delayForMultipleNewTabs: 300,
  delayForNewWindow: 1000,
  debug: false
}, {
  localKeys: `
    debug
  `.trim().split('\n').map(aKey => aKey.trim()).filter(aKey => aKey && aKey.indexOf('//') != 0)
});
