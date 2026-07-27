import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [app, home, styles, database, main] = await Promise.all([
  readFile(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/components/ConsoleHome.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/database.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/main.ts', import.meta.url), 'utf8')
]);

assert.doesNotMatch(
  home,
  /props\.selectedGame\?\.source\s*\|\|\s*'NXGS library'/,
  'customer Home must not expose the game launch source'
);
assert.doesNotMatch(
  home,
  /props\.game\?\.source/,
  'customer dashboard cards must not expose the game launch source'
);
assert.match(
  home,
  /<h1 title=\{props\.selectedGame\?\.title \?\? 'Welcome to NXGS Play'\}>[\s\S]*props\.selectedGame\?\.title \?\? 'Welcome to NXGS Play'/,
  'the full game name must remain available as the title while the visible text truncates'
);
assert.match(app, /const \[selectedIndex, setSelectedIndex\] = useState\(-1\)/, 'NXGS Home must be the initial selection');
assert.match(
  home,
  /aria-label=\{`NXGS Home[\s\S]*props\.games\.map/,
  'the NXGS Home tile must render before the game list'
);
assert.match(home, /Launcher overview/, 'NXGS Home must show launcher overview content');
assert.match(database, /branding:\s*\{\s*logoPath:\s*''/, 'the persisted settings model must include a logo path');
assert.match(main, /dialog:selectBrandLogo[\s\S]*app\.getPath\('userData'\)[\s\S]*copyFile/, 'custom logos must be copied into NXGS app data');
assert.match(app, /pendingAction === 'upload'[\s\S]*Updating\.\.\./, 'logo upload must expose immediate pending feedback');
assert.match(
  styles,
  /\.console-hero-copy\s*\{[^}]*left:\s*64px;[^}]*right:\s*64px;/s,
  'hero copy must use the available launcher width'
);
assert.match(
  styles,
  /\.console-hero-copy h1\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s,
  'hero title must remain on one line and end with an ellipsis'
);
assert.match(
  styles,
  /button\.console-game-avatar:not\(:disabled\):hover,[^}]*button\.console-game-avatar:not\(:disabled\):is\(:focus-visible, \.controller-focused, \.focused\),[^}]*button\.console-game-avatar:not\(:disabled\):active\s*\{[^}]*box-shadow:\s*none;[^}]*filter:\s*none;/s,
  'the game avatar button must suppress the outer rectangular hover and focus ring'
);
assert.match(
  styles,
  /\.console-tabs button:not\(:disabled\):hover,[^}]*\.console-tabs button:not\(:disabled\):is\(:focus-visible, \.controller-focused, \.focused\),[^}]*\.console-tabs button:not\(:disabled\):active\s*\{[^}]*box-shadow:\s*none;[^}]*filter:\s*none;/s,
  'tab buttons must suppress the inner rectangular hover and focus ring'
);

console.log('NXGS Home default focus, overview, persisted branding, hero title, and rounded focus treatments verified.');
