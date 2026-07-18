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
const settingsStyles = await readFile(
  new URL('../src/renderer/styles.css', import.meta.url),
  'utf8'
);
const pairFunction = bluetoothSource.slice(
  bluetoothSource.indexOf('export async function pairBluetoothDevice'),
  bluetoothSource.indexOf('export async function disconnectBluetoothDevice')
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
  /\$device\.Connected = \[bool\]\$device\.Connected -or \$inputReady/,
  'active HID controller input must promote the Bluetooth device to connected'
);
assert.match(
  bluetoothSource,
  /BluetoothSetServiceState/,
  'paired controller reconnect must request the HID service through the supported native API'
);
assert.match(
  bluetoothSource,
  /BluetoothRegisterForAuthenticationEx/,
  'pairing must register NXGS for native authentication so no external pairing wizard is shown'
);
assert.match(
  bluetoothSource,
  /BluetoothSendAuthenticationResponseEx/,
  'NXGS must answer compatible controller pairing requests through the native callback'
);
assert.match(
  bluetoothSource,
  /BluetoothAuthenticateDeviceEx\(IntPtr\.Zero/,
  'native pairing must not attach an external authentication wizard to the launcher'
);
assert.match(
  bluetoothSource,
  /verified\.Authenticated && verified\.Remembered/,
  'an accepted authentication callback must be verified as an authenticated, saved bond'
);
assert.match(
  bluetoothSource,
  /Success = responseAccepted && paired/,
  'native pairing success must require the verified saved bond'
);
assert.match(
  bluetoothSource,
  /TryFindDevice\(address, false, out info\) \|\| TryFindDevice\(address, true, out info\)/,
  'pairing must reuse the selected scan record before spending time on another inquiry'
);
assert.match(
  bluetoothSource,
  /staff-approval-required/,
  'unsupported pairing methods must stay inside NXGS and report staff approval required'
);
assert.match(
  bluetoothSource,
  /CONNECT_CONTROLLER_SCRIPT/,
  'paired controllers must have an explicit connection request path'
);
assert.match(
  bluetoothSource,
  /Requesting the HID controller service/,
  'controller reconnect must request service activation instead of reporting pairing success immediately'
);
assert.doesNotMatch(
  pairFunction,
  /DISCONNECT_SCRIPT/,
  'pairing and input checks must never disconnect or power off the controller'
);
assert.match(
  pairFunction,
  /waitForControllerInput/,
  'controller input checks must wait for Windows HID enumeration'
);
assert.match(
  pairFunction,
  /const before = request\.fastPairing \? fallbackBluetooth : await scanBluetoothDevices\(false\)/,
  'new pairing must skip the redundant pre-authentication status scan'
);
assert.match(
  bluetoothSource,
  /\$connection = if \(\$result\.Success -and \$result\.Paired\)/,
  'controller input activation must be requested immediately after verified pairing'
);
assert.doesNotMatch(
  bluetoothSource.slice(
    bluetoothSource.indexOf('public static NxgsBluetoothAction RequestHidConnection'),
    bluetoothSource.indexOf('public static NxgsBluetoothAction Disconnect')
  ),
  /if \(selected\.Connected\) return/,
  'a base Bluetooth link must not skip the controller input service request'
);
assert.match(
  pairFunction,
  /const checked = await waitForControllerInput\(deviceId, 5\)/,
  'new pairing must check for real controller input before reporting a connected result'
);
assert.doesNotMatch(
  pairFunction,
  /optimisticDevice|Pairing complete\. Controller input is connecting automatically/,
  'pairing must never create an optimistic completed device state'
);
assert.match(
  settingsSource,
  /Controller input unavailable/,
  'settings must explain that the Bluetooth link can exist without controller input'
);
assert.match(
  settingsSource,
  /Check Input/,
  'settings must expose the non-destructive controller input check'
);
assert.match(
  settingsSource,
  /Checking\.\.\./,
  'the asynchronous input check must show visible loading feedback'
);
assert.match(
  settingsSource,
  /disabled=\{bluetoothPending !== null/,
  'Bluetooth actions must reject duplicate clicks while recovery is pending'
);
assert.match(
  settingsSource,
  /const effectiveConnected = device\.connected \|\| device\.inputReady \|\| launcherInputActive/,
  'the Bluetooth row must treat active launcher input as a connected controller'
);
assert.match(
  settingsSource,
  /Pairing request/,
  'unpaired devices must use an NXGS pairing request inside the launcher'
);
assert.match(
  settingsSource,
  /createPortal\(/,
  'the pairing confirmation must be portaled outside the scrollable settings panel'
);
assert.match(
  settingsSource,
  /#bluetooth-pair-primary/,
  'the pairing confirmation must move focus to its primary controller action'
);
assert.match(
  settingsStyles,
  /\.bluetooth-confirmation-backdrop\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*place-items:\s*center;/s,
  'the pairing overlay must cover and center within the visible viewport'
);
assert.match(
  settingsSource,
  /bluetoothPairingAttempt\.current \+= 1;[^]*cancelBluetoothPairing\(\);[^]*setBluetoothPairingTarget\(null\)/,
  'B and Escape must terminate an in-flight pairing request before dismissing the confirmation'
);
assert.match(
  settingsSource,
  /if \(attempt !== bluetoothPairingAttempt\.current\) return;/,
  'a cancelled pairing request must not restore stale modal state when its promise settles'
);
assert.match(
  bluetoothSource,
  /export function cancelBluetoothPairing\(\)/,
  'the main Bluetooth service must expose in-flight native pairing cancellation'
);
assert.match(
  settingsSource,
  /bluetoothPairingStage === 'input-required'/,
  'the pairing modal must preserve a recoverable state when controller input is unavailable'
);
assert.match(
  settingsSource,
  /bluetoothPairingStage === 'connected'[\s\S]*?\? 'Connected'/,
  'the pairing modal must reserve its completed state for verified controller input'
);
assert.match(
  settingsSource,
  /Pairing failed/,
  'the NXGS pairing flow must show a retryable failure state'
);
assert.match(
  settingsSource,
  /Staff approval required/,
  'unsupported authentication must be explained without leaving the launcher'
);
assert.match(
  settingsSource,
  /bluetoothPairingStage === 'pairing'[^]*disabled=/,
  'the pairing dialog must disable repeat actions while native pairing is pending'
);

if (process.platform === 'win32') {
  const runBluetoothScript = (script, environment = {}) => new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
      { windowsHide: true, env: { ...process.env, ...environment }, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const output = [];
    const errors = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Live Bluetooth script timed out.'));
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
  const preambleMatch = bluetoothSource.match(
    /const NATIVE_BLUETOOTH_PREAMBLE = String\.raw`([\s\S]*?)`;\s+const SCAN_SCRIPT/
  );
  const scanMatch = bluetoothSource.match(
    /const SCAN_SCRIPT = `\$\{NATIVE_BLUETOOTH_PREAMBLE\}([\s\S]*?)`;\s+const PAIR_SCRIPT/
  );
  assert.ok(preambleMatch?.[1] && scanMatch?.[1], 'live Bluetooth scan script must be extractable');
  const script = `${preambleMatch[1]}${scanMatch[1]}`;
  const stdout = await runBluetoothScript(script);
  const live = JSON.parse(stdout.trim());
  const devices = !live.devices ? [] : Array.isArray(live.devices) ? live.devices : [live.devices];
  for (const device of devices) {
    assert.equal(typeof device.Controller, 'boolean', 'live devices must report whether they are controllers');
    assert.equal(typeof device.InputReady, 'boolean', 'live devices must report whether their HID input profile is ready');
  }
  const dualSense = devices.find((device) => /dualsense/i.test(String(device.Name)));
  if (dualSense) {
    assert.equal(dualSense.Controller, true, 'the live DualSense must be classified as a controller');
    const inputScriptMatch = bluetoothSource.match(
      /const CONTROLLER_INPUT_SCRIPT = String\.raw`([\s\S]*?)`;\s+const CONNECT_CONTROLLER_SCRIPT/
    );
    assert.ok(inputScriptMatch?.[1], 'lightweight controller input probe must be extractable');
    const inputProbe = JSON.parse(await runBluetoothScript(inputScriptMatch[1], {
      NXGS_BLUETOOTH_DEVICE_ID: String(dualSense.Id)
    }));
    assert.equal(typeof inputProbe.inputReady, 'boolean', 'live controller input probe must return a Boolean readiness state');
    console.log(
      `INFO: Live DualSense Bluetooth link connected=${Boolean(dualSense.Connected)}, inputReady=${Boolean(dualSense.InputReady)}, fastProbe=${inputProbe.inputReady}.`
    );
  }
}

console.log('PASS: Bluetooth status distinguishes a paired link from an active HID controller.');
console.log('PASS: Controller input checks preserve Bluetooth and use visible pending feedback.');
