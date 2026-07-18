import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

async function hash(relativePath) {
  return createHash('sha256').update(await readFile(resolve(root, relativePath))).digest('hex');
}

const [service, main, styles, packageJson, chickenInvadersProfile, autoProfiles] = await Promise.all([
  readFile(resolve(root, 'src/main/controllerCompatibilityService.ts'), 'utf8'),
  readFile(resolve(root, 'src/main/main.ts'), 'utf8'),
  readFile(resolve(root, 'src/renderer/styles.css'), 'utf8'),
  readFile(resolve(root, 'package.json'), 'utf8'),
  readFile(resolve(root, 'vendor/controller-bridge/Profiles/Chicken Invaders 4.xml'), 'utf8'),
  readFile(resolve(root, 'vendor/controller-bridge/Auto Profiles.xml'), 'utf8')
]);

assert.equal(
  await hash('vendor/controller-bridge/DS4Windows.exe'),
  '6267cba17b87ada8f13ec6e187b309e3c76aa087acf2c255ab19dc2db6799a34',
  'DS4Windows launcher must match the reviewed 3.5 release'
);
assert.equal(
  await hash('vendor/controller-bridge/DS4Windows.dll'),
  'bd7497e24cfcededa70683fa58c738901e4ca86c1d8ec98567a971faf03ebffd',
  'DS4Windows assembly must match the reviewed 3.5 release'
);
assert.equal(
  await hash('vendor/controller-bridge/ViGEmBus_1.22.0_x64_x86_arm64.exe'),
  '89220a7865076b342892f98865f3499fb7c4cfd673159e89d352c360fd014c6a',
  'ViGEmBus must match the vendor-signed final release'
);

assert.match(service, /spawn\(executable, \['-m'\]/, 'controller mapper must start minimized');
assert.match(service, /ds4windows-3\.5-nxgs-4/, 'controller bridge runtime version must refresh bundled game profiles');
assert.match(service, /ensureReady\(\)/, 'controller bridge must expose a readiness boundary');
assert.match(service, /ensureReadyForGame\(game: GameRecord\)/, 'controller bridge must expose deterministic per-game profile activation');
assert.match(service, /LoadTempProfile\.1\.\$\{profileName\}/, 'per-game profiles must be loaded explicitly through the mapper IPC');
assert.match(service, /Query\.1\.ProfileName/, 'per-game profile activation must be verified through the mapper IPC');
assert.match(service, /probe-xinput\.ps1/, 'controller bridge must confirm actual XInput visibility');
assert.match(service, /install-driver\.ps1/, 'packaged builds must support the signed driver setup');
assert.match(service, /async prepare\(\)/, 'launcher startup must prepare bridge files without starting the mapper');
assert.match(main, /await controllerCompatibility\.ensureReadyForGame\(game\);[\s\S]*await launcher\.launch\(game\)/, 'launch must activate the correct controller profile before the game handoff');
assert.match(main, /game:resumeActive[\s\S]*controllerCompatibility\.ensureReadyForGame\(game\)/, 'resume must reactivate the correct game profile');
assert.doesNotMatch(main, /controllerCompatibility\.start\(\{ allowDriverInstall: app\.isPackaged \}\)/, 'launcher Home must not start the gameplay mapper');
assert.match(main, /controllerCompatibility\.prepare\(\)/, 'launcher Home may validate bridge assets without claiming the controller');
assert.match(main, /game:minimizeActive[\s\S]*controllerCompatibility\.stop\(\)/, 'returning to launcher Home must stop the gameplay mapper');
assert.match(main, /onGameExited:[\s\S]*controllerCompatibility\.stop\(\)/, 'game exit must release the gameplay mapper');
assert.match(packageJson, /"from": "vendor\/controller-bridge"[\s\S]*"to": "controller-bridge"/, 'controller bridge assets must be packaged');

assert.match(chickenInvadersProfile, /<DinputOnly>True<\/DinputOnly>/, 'Chicken Invaders must suppress duplicate virtual-controller output');
for (const [control, virtualKey] of [
  ['LYNeg', 38],
  ['LYPos', 40],
  ['LXNeg', 37],
  ['LXPos', 39],
  ['DpadUp', 38],
  ['DpadDown', 40],
  ['DpadLeft', 37],
  ['DpadRight', 39],
  ['Cross', 32]
]) {
  assert.match(
    chickenInvadersProfile,
    new RegExp(`<${control}>${virtualKey}<\\/${control}>`),
    `${control} must map to the expected Chicken Invaders keyboard control`
  );
}
assert.match(autoProfiles, /<Programs\s*\/>/, 'unreliable foreground-process auto profiles must remain disabled');
assert.match(service, /CHICKEN_INVADERS_AUMID[\s\S]*CHICKEN_INVADERS_PROFILE/, 'Chicken Invaders must be matched by its stable Store application identity');

assert.match(styles, /button:not\(:disabled\):is\(:focus-visible, \.controller-focused, \.focused\)/, 'all focused buttons must receive the global console focus ring');
assert.match(styles, /button:not\(:disabled\):hover/, 'all buttons must have a hover state');
assert.match(styles, /button:not\(:disabled\):active/, 'all buttons must have a pressed state');
assert.match(
  styles,
  /button:not\(:disabled\):is\(:focus-visible, \.controller-focused, \.focused\)\s*\{[^}]*outline:\s*none;/,
  'global button focus must keep the browser outline suppressed'
);

if (process.platform === 'win32') {
  try {
    const output = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        resolve(root, 'vendor/controller-bridge/probe-xinput.ps1')
      ],
      { encoding: 'utf8', timeout: 10_000, windowsHide: true }
    );
    const probe = JSON.parse(output.trim());
    console.log(`Controller bridge source verified; live XInput connected: ${probe.connected ? 'yes' : 'no'}.`);
  } catch {
    console.log('Controller bridge source verified; live XInput probe was unavailable in this environment.');
  }
} else {
  console.log('Controller bridge source verified.');
}
