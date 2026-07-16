import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [home, styles] = await Promise.all([
  readFile(new URL('../src/renderer/components/ConsoleHome.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8')
]);

assert.doesNotMatch(
  home,
  /props\.selectedGame\?\.source\s*\|\|\s*'NXGS library'/,
  'customer Home must not expose the game launch source'
);
assert.match(
  home,
  /<h1 title=\{props\.selectedGame\?\.title\}>\{props\.selectedGame\?\.title\}<\/h1>/,
  'the full game name must remain available as the title while the visible text truncates'
);
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

console.log('Console Home source-label removal and one-line hero title verified.');
