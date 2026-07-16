import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const bluetoothSource = await readFile(
  new URL('../src/main/bluetoothService.ts', import.meta.url),
  'utf8'
);
const settingsSource = await readFile(
  new URL('../src/renderer/components/ConsoleSettings.tsx', import.meta.url),
  'utf8'
);
const sharedTypes = await readFile(
  new URL('../src/shared/types.ts', import.meta.url),
  'utf8'
);

assert.match(
  sharedTypes,
  /controller:\s*boolean;\s+inputReady:\s*boolean;/,
  'Bluetooth device summaries must distinguish controller devices from active input readiness'
);
assert.match(
  bluetoothSource,
  /Get-PnpDevice -PresentOnly -Class HIDClass/,
  'Bluetooth status must check for a present HID input interface'
);
assert.doesNotMatch(
  bluetoothSource,
  /-EncodedCommand/,
  'Bluetooth scripts must not be placed on the Windows command line'
);
assert.match(
  bluetoothSource,
  /child\.stdin\.end\(`\$\{script\}\\r\\n`, 'utf8'\)/,
  'Bluetooth scripts must be streamed through PowerShell standard input'
);
assert.match(
  bluetoothSource,
  /DEVPKEY_Device_ContainerId/,
  'Bluetooth and HID interfaces must be matched by their Windows device container'
);
assert.match(
  bluetoothSource,
  /Resetting stale Bluetooth controller link/,
  'paired controllers with a stale base link must enter the recovery flow'
);
assert.match(
  bluetoothSource,
  /runPowerShell<RawBluetoothAction>\(DISCONNECT_SCRIPT/,
  'controller recovery must reset the stale Bluetooth link instead of returning success without action'
);
assert.match(
  settingsSource,
  /Controller input unavailable/,
  'settings must explain that the Bluetooth link can exist without controller input'
);
assert.match(
  settingsSource,
  /Repair Input/,
  'settings must expose the controller input recovery action'
);
assert.match(
  settingsSource,
  /Repairing\.\.\./,
  'the asynchronous recovery action must show visible loading feedback'
);
assert.match(
  settingsSource,
  /disabled=\{bluetoothPending !== null/,
  'Bluetooth actions must reject duplicate clicks while recovery is pending'
);

if (process.platform === 'win32') {
  const preambleMatch = bluetoothSource.match(
    /const NATIVE_BLUETOOTH_PREAMBLE = String\.raw`([\s\S]*?)`;\s+const SCAN_SCRIPT/
  );
  const scanMatch = bluetoothSource.match(
    /const SCAN_SCRIPT = `\$\{NATIVE_BLUETOOTH_PREAMBLE\}([\s\S]*?)`;\s+const PAIR_SCRIPT/
  );
  assert.ok(preambleMatch?.[1] && scanMatch?.[1], 'live Bluetooth scan script must be extractable');
  const script = `${preambleMatch[1]}${scanMatch[1]}`;
  const stdout = await new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const output = [];
    const errors = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Live Bluetooth scan timed out.'));
    }, 25000);
    child.stdout.on('data', (chunk) => output.push(chunk));
    child.stderr.on('data', (chunk) => errors.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const outputText = Buffer.concat(output).toString('utf8');
      const errorText = Buffer.concat(errors).toString('utf8');
      if (code === 0 && outputText.trim()) resolve(outputText);
      else reject(new Error(errorText || `PowerShell exited with ${code} and returned no Bluetooth data.`));
    });
    child.stdin.end(`${script}\r\n`);
  });
  const live = JSON.parse(stdout.trim());
  const devices = !live.devices ? [] : Array.isArray(live.devices) ? live.devices : [live.devices];
  for (const device of devices) {
    assert.equal(typeof device.Controller, 'boolean', 'live devices must report whether they are controllers');
    assert.equal(typeof device.InputReady, 'boolean', 'live devices must report whether their HID input profile is ready');
  }
  const dualSense = devices.find((device) => /dualsense/i.test(String(device.Name)));
  if (dualSense) {
    assert.equal(dualSense.Controller, true, 'the live DualSense must be classified as a controller');
    console.log(
      `INFO: Live DualSense Bluetooth link connected=${Boolean(dualSense.Connected)}, inputReady=${Boolean(dualSense.InputReady)}.`
    );
  }
}

console.log('PASS: Bluetooth status distinguishes a paired link from an active HID controller.');
console.log('PASS: Stale controller links use the recovery flow with visible pending feedback.');
