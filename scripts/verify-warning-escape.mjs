import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWindowsControl, stopWindowsControlWorker, warmWindowsControlWorker } from '../src/main/windowsControlWorker.ts';

if (process.platform !== 'win32') {
  console.log('Native warning Escape verification skipped outside Windows.');
  process.exit(0);
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'nxgs-warning-escape-'));
const handlePath = join(temporaryDirectory, 'handle.txt');
const receivedPath = join(temporaryDirectory, 'received.txt');
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const formScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System.Runtime.InteropServices;
public static class NxgsEscapeProbe {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int virtualKey);
}
'@
$form = New-Object System.Windows.Forms.Form
$form.Text = 'NXGS Escape Delivery Test'
$form.Width = 460
$form.Height = 260
$form.StartPosition = 'CenterScreen'
$form.KeyPreview = $true
$form.Add_Shown({
  [IO.File]::WriteAllText(${quote(handlePath)}, $form.Handle.ToInt64().ToString())
  $form.Activate()
})
$form.Add_KeyDown({
  param($sender, $event)
  if ($event.KeyCode -eq [System.Windows.Forms.Keys]::Escape) {
    [IO.File]::WriteAllText(${quote(receivedPath)}, 'escape')
  }
})
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 10
$timer.Add_Tick({
  if (([NxgsEscapeProbe]::GetAsyncKeyState(0x1B) -band 0x8000) -ne 0) {
    [IO.File]::WriteAllText(${quote(receivedPath)}, 'escape')
  }
})
$timer.Start()
[System.Windows.Forms.Application]::Run($form)
`;
const encoded = Buffer.from(formScript, 'utf16le').toString('base64');
const form = spawn(
  'powershell.exe',
  ['-NoLogo', '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
  { windowsHide: true, stdio: 'ignore' }
);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

try {
  let handle = 0;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      handle = Number(await readFile(handlePath, 'utf8'));
      if (handle > 0) break;
    } catch {}
    await delay(50);
  }
  assert.ok(handle > 0, 'The native Escape test window did not expose a handle.');

  warmWindowsControlWorker();
  const result = await runWindowsControl('escape', handle);
  assert.equal(result.ok, true, result.message);

  let received = '';
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      received = await readFile(receivedPath, 'utf8');
      if (received === 'escape') break;
    } catch {}
    await delay(50);
  }
  assert.equal(received, 'escape', 'The foreground window did not receive the native Escape key press.');
  console.log('Native foreground Escape delivery verified against a real Windows test window.');
} finally {
  stopWindowsControlWorker();
  if (form.exitCode === null) form.kill();
  await rm(temporaryDirectory, { recursive: true, force: true });
}
