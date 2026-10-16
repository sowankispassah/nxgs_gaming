import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Customers must only ever see a game console: never a launcher, an overlay
// on top of Windows, or a kiosk. This scans the text on every customer screen
// and the game status messages main sends to them. Staff screens (Control
// Room, admin dialogs) and log lines are not checked.
const RESTRICTED = /\b(launcher|overlay|kiosk|taskbar|desktop|minimi[sz]ed?|fullscreen|full-screen|executable)\b|NXGS quick/i;

const CUSTOMER_SCREENS = [
  'ConsoleHome.tsx',
  'ConsoleSettings.tsx',
  'QuickHomeOverlay.tsx',
  'home/ActiveGameDock.tsx',
  'home/MediaShelf.tsx',
  'control-center/ControlCenterClosing.tsx',
  'control-center/ControlCenterGameCard.tsx',
  'control-center/ControlCenterQuickSettings.tsx',
  'control-center/ControlCenterStatus.tsx',
  'control-center/ControlCenterSwitcher.tsx',
  'settings/SettingsInfoPages.tsx',
  'settings/SettingsParts.tsx',
  'system/GameTransitionOverlay.tsx',
  'dialogs/PaymentFlow.tsx'
];

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

/** String literals and JSX text that read like words, not class names or keys. */
function visibleText(source) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const pieces = [
    ...withoutComments.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)
  ].map((match) => match[1] ?? match[2] ?? match[3]);
  pieces.push(...[...withoutComments.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)].map((match) => match[1]));
  return pieces
    .map((text) => text.trim())
    .filter((text) => /[A-Za-z]/.test(text))
    // Class lists and keys, including templated ones like `tile ${state}`.
    .filter((text) => !text.replace(/\$\{[^}]*\}/g, ' ').trim().split(/\s+/).every((token) => /^[a-z0-9_-]*$/.test(token)))
    .filter((text) => !/^[./@]/.test(text)); // imports and paths
}

const offenders = [];
for (const screen of CUSTOMER_SCREENS) {
  for (const text of visibleText(await read(`../src/renderer/components/${screen}`))) {
    if (RESTRICTED.test(text)) offenders.push(`${screen}: ${text}`);
  }
}

// Status and error text main hands to customer screens.
const launcher = await read('../src/main/gameLauncher.ts');
for (const match of launcher.matchAll(/\b(?:message|error|customerMessage)\s*[:=]\s*([^;]*?)(?:,\n|;\n|\n\s*\})/g)) {
  for (const text of visibleText(match[1])) {
    if (RESTRICTED.test(text)) offenders.push(`gameLauncher.ts: ${text}`);
  }
}

// Payment failures (such as net::ERR_NAME_NOT_RESOLVED or the payment
// function's error codes) are logged; customers get a plain message.
const payment = await read('../src/main/paymentService.ts');
assert.match(payment, /error: CUSTOMER_PAYMENT_MESSAGES\[reason\] \?\? PAYMENTS_UNAVAILABLE/, 'payment errors must be translated for customers');
assert.doesNotMatch(payment, /error: error instanceof Error \? error\.message/, 'raw payment errors must never reach the checkout screen');

assert.deepEqual(offenders, [], `customer-facing text must read like a console, not a launcher:\n${offenders.join('\n')}`);
console.log(`Console language verified across ${CUSTOMER_SCREENS.length} customer screens and game status messages.`);
