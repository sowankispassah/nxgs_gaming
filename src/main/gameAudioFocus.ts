import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { logLine } from './logger';

/** One tracked game's processes and whether it is the game on screen. */
export interface GameAudioTarget {
  gameId: string;
  title: string;
  processIds: number[];
  /** Image names to match while no process id is known, e.g. a slow Steam start. */
  processNames: string[];
  audible: boolean;
}

type AudioSessionReply = {
  id: number;
  ok: boolean;
  sessions?: Record<string, number>;
  message?: string;
};

type InFlightPass = {
  id: number;
  timeout: NodeJS.Timeout;
  released: string[];
  audibleGameId: string | null;
  audibleKeys: string[];
};

// A game that just came forward may not have opened its audio session yet,
// so unmuting it is retried quickly until Windows reports one. After that an
// occasional pass keeps background games muted and the game on screen not.
const UNCONFIRMED_PASS_INTERVAL_MS = 1000;
const STEADY_PASS_INTERVAL_MS = 3000;
// A fresh worker's first reply also waits for PowerShell to compile the helper.
const FIRST_REQUEST_TIMEOUT_MS = 45000;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_RETRY_DELAY_MS = 60000;

// Mutes per-process Windows audio sessions (the Volume Mixer entries), never
// the system volume. Sessions match by process id, or by image name for a game
// whose process id is not known yet. Returns, per matched key, how many
// sessions now have the requested state.
const WORKER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class NxgsGameAudio {
    private enum EDataFlow { Render = 0, Capture = 1, All = 2 }

    [ComImport]
    [Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class MMDeviceEnumeratorComObject { }

    [ComImport]
    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator {
        [PreserveSig] int EnumAudioEndpoints(EDataFlow dataFlow, uint stateMask, out IMMDeviceCollection devices);
    }

    [ComImport]
    [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceCollection {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int Item(uint index, out IMMDevice device);
    }

    [ComImport]
    [Guid("D666063F-1587-4E43-81F1-B948E807363F")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice {
        [PreserveSig] int Activate(ref Guid iid, uint context, IntPtr activationParameters, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
    }

    [ComImport]
    [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionManager2 {
        [PreserveSig] int GetAudioSessionControl(IntPtr sessionGuid, uint streamFlags, out IntPtr sessionControl);
        [PreserveSig] int GetSimpleAudioVolume(IntPtr sessionGuid, uint streamFlags, out IntPtr audioVolume);
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
    }

    [ComImport]
    [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionEnumerator {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetSession(int index, [MarshalAs(UnmanagedType.IUnknown)] out object session);
    }

    [ComImport]
    [Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionControl2 {
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName(out IntPtr name);
        [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid eventContext);
        [PreserveSig] int GetIconPath(out IntPtr path);
        [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid eventContext);
        [PreserveSig] int GetGroupingParam(out Guid groupingParam);
        [PreserveSig] int SetGroupingParam(ref Guid groupingParam, ref Guid eventContext);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr client);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr client);
        [PreserveSig] int GetSessionIdentifier(out IntPtr identifier);
        [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr identifier);
        [PreserveSig] int GetProcessId(out uint processId);
    }

    [ComImport]
    [Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ISimpleAudioVolume {
        [PreserveSig] int SetMasterVolume(float level, ref Guid eventContext);
        [PreserveSig] int GetMasterVolume(out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool muted, ref Guid eventContext);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool muted);
    }

    private const uint DeviceStateActive = 1;
    private const uint ClsCtxAll = 23;
    private static readonly Guid SessionManagerId = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");

    private static void Release(object instance) {
        if (instance != null && Marshal.IsComObject(instance)) Marshal.ReleaseComObject(instance);
    }

    private static string ImageName(uint processId, Dictionary<uint, string> cache) {
        string name;
        if (cache.TryGetValue(processId, out name)) return name;
        name = "";
        try {
            using (var process = System.Diagnostics.Process.GetProcessById((int)processId)) {
                name = process.ProcessName.ToLowerInvariant();
            }
        } catch (ArgumentException) {
        } catch (InvalidOperationException) { }
        cache[processId] = name;
        return name;
    }

    public static Dictionary<string, int> Apply(int[] mute, int[] unmute, string[] muteNames, string[] unmuteNames) {
        var mutedIds = new HashSet<uint>();
        var unmutedIds = new HashSet<uint>();
        var mutedNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var unmutedNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var processId in unmute) if (processId > 0) unmutedIds.Add((uint)processId);
        foreach (var processId in mute) if (processId > 0) mutedIds.Add((uint)processId);
        foreach (var name in unmuteNames) if (!String.IsNullOrWhiteSpace(name)) unmutedNames.Add(name);
        foreach (var name in muteNames) if (!String.IsNullOrWhiteSpace(name)) mutedNames.Add(name);
        var matches = new Dictionary<string, int>();
        if (mutedIds.Count + unmutedIds.Count + mutedNames.Count + unmutedNames.Count == 0) return matches;
        var matchNames = mutedNames.Count + unmutedNames.Count > 0;
        var names = new Dictionary<uint, string>();

        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        IMMDeviceCollection devices = null;
        try {
            if (enumerator.EnumAudioEndpoints(EDataFlow.Render, DeviceStateActive, out devices) != 0 || devices == null) return matches;
            uint deviceCount;
            if (devices.GetCount(out deviceCount) != 0) return matches;
            for (uint deviceIndex = 0; deviceIndex < deviceCount; deviceIndex += 1) {
                IMMDevice device = null;
                object manager = null;
                IAudioSessionEnumerator sessions = null;
                try {
                    if (devices.Item(deviceIndex, out device) != 0 || device == null) continue;
                    var iid = SessionManagerId;
                    if (device.Activate(ref iid, ClsCtxAll, IntPtr.Zero, out manager) != 0 || manager == null) continue;
                    if (((IAudioSessionManager2)manager).GetSessionEnumerator(out sessions) != 0 || sessions == null) continue;
                    int sessionCount;
                    if (sessions.GetCount(out sessionCount) != 0) continue;
                    for (var sessionIndex = 0; sessionIndex < sessionCount; sessionIndex += 1) {
                        object session = null;
                        try {
                            if (sessions.GetSession(sessionIndex, out session) != 0 || session == null) continue;
                            var control = session as IAudioSessionControl2;
                            var volume = session as ISimpleAudioVolume;
                            uint processId;
                            // AUDCLNT_S_NO_SINGLE_PROCESS is a success code for
                            // shared sessions; those never belong to one game.
                            // Process id 0 is the system sounds session.
                            if (control == null || volume == null || control.GetProcessId(out processId) != 0 || processId == 0) continue;
                            string key = null;
                            var shouldMute = false;
                            if (unmutedIds.Contains(processId)) {
                                key = processId.ToString();
                            } else if (mutedIds.Contains(processId)) {
                                key = processId.ToString();
                                shouldMute = true;
                            } else if (matchNames) {
                                var name = ImageName(processId, names);
                                // An unmute always wins, so a game on screen is
                                // never silenced by another game's name.
                                if (name.Length > 0 && unmutedNames.Contains(name)) {
                                    key = "name:" + name;
                                } else if (name.Length > 0 && mutedNames.Contains(name)) {
                                    key = "name:" + name;
                                    shouldMute = true;
                                }
                            }
                            if (key == null) continue;
                            bool current;
                            var applied = volume.GetMute(out current) == 0 && current == shouldMute;
                            if (!applied) {
                                var context = Guid.Empty;
                                applied = volume.SetMute(shouldMute, ref context) == 0;
                            }
                            if (!applied) continue;
                            int count;
                            matches.TryGetValue(key, out count);
                            matches[key] = count + 1;
                        } finally {
                            Release(session);
                        }
                    }
                } finally {
                    Release(sessions);
                    Release(manager);
                    Release(device);
                }
            }
        } finally {
            Release(devices);
            Release(enumerator);
        }
        return matches;
    }
}
'@ | Out-Null

while (($line = [Console]::In.ReadLine()) -ne $null) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $request = $null
    try {
        $request = $line | ConvertFrom-Json
        $sessions = [NxgsGameAudio]::Apply(
            [int[]]@($request.mute | Where-Object { $null -ne $_ }),
            [int[]]@($request.unmute | Where-Object { $null -ne $_ }),
            [string[]]@($request.muteNames | Where-Object { $null -ne $_ }),
            [string[]]@($request.unmuteNames | Where-Object { $null -ne $_ })
        )
        $response = @{ id = $request.id; ok = $true; sessions = $sessions }
    } catch {
        $response = @{ id = $(if ($null -ne $request) { $request.id } else { 0 }); ok = $false; message = $_.Exception.Message }
    }
    [Console]::Out.WriteLine(($response | ConvertTo-Json -Depth 4 -Compress))
    [Console]::Out.Flush()
}
`;

/** Image names are compared without ".exe", case-insensitively. */
export function normalizeProcessName(name: string | undefined | null): string {
  return (name ?? '').trim().replace(/\.exe$/i, '').toLowerCase();
}

// Mute keys: "123" for a process id, "name:game" for an image name. These match
// the keys the worker reports back.
function keysFor(target: GameAudioTarget): string[] {
  if (target.processIds.length > 0) return target.processIds.map(String);
  return target.processNames.map(normalizeProcessName).filter(Boolean).map((name) => `name:${name}`);
}

function splitKeys(keys: Iterable<string>): { ids: number[]; names: string[] } {
  const ids: number[] = [];
  const names: string[] = [];
  for (const key of keys) {
    if (key.startsWith('name:')) names.push(key.slice('name:'.length));
    else ids.push(Number(key));
  }
  return { ids, names };
}

/**
 * Keeps only the game on screen audible. Every other tracked game (one parked
 * behind Launcher Home, or one the switcher moved away from) has its own
 * Windows audio session muted until it is on screen again.
 */
export class GameAudioFocus {
  private worker: ChildProcessWithoutNullStreams | null = null;
  private workerAnswered = false;
  private stdoutBuffer = '';
  private stderrTail = '';
  private nextRequestId = 0;
  private inFlight: InFlightPass | null = null;
  private pendingPass = false;
  private timer: NodeJS.Timeout | null = null;
  private targets: GameAudioTarget[] = [];
  private audibleGameId: string | null = null;
  private audibleKeys = new Set<string>();
  private backgroundKeys = new Set<string>();
  // Keys NXGS muted and has not yet confirmed releasing.
  private muted = new Set<string>();
  // Windows remembers a session's mute across app restarts, so a game NXGS
  // once muted can start silent. Until Windows reports a session for the game
  // on screen, passes run every second; every pass re-asserts its unmute.
  private audibleConfirmed = false;
  private lastPassAt = 0;
  private failures = 0;
  private retryAt = 0;
  private lastFailure = '';
  private stopped = false;

  constructor(private readonly readTargets: () => GameAudioTarget[]) {}

  /** Starts the helper early so its compile never lands on a game launch. */
  warm(): void {
    if (process.platform !== 'win32' || this.stopped) return;
    try {
      this.ensureWorker();
    } catch (error) {
      this.reportFailure(`could not start: ${String(error)}`);
    }
  }

  /** Re-reads the tracked games; call after every game state change. */
  refresh(): void {
    if (process.platform !== 'win32' || this.stopped) return;
    const targets = this.readTargets();
    this.targets = targets;
    const audible = targets.find((target) => target.audible) ?? null;
    const audibleKeys = new Set(audible ? keysFor(audible) : []);
    const backgroundKeys = new Set<string>();
    for (const target of targets) {
      if (target.audible) continue;
      for (const key of keysFor(target)) if (!audibleKeys.has(key)) backgroundKeys.add(key);
    }
    const audibleChanged = (audible?.gameId ?? null) !== this.audibleGameId || !sameSet(audibleKeys, this.audibleKeys);
    const changed = audibleChanged || !sameSet(backgroundKeys, this.backgroundKeys);
    if (audibleChanged) this.audibleConfirmed = false;
    this.audibleGameId = audible?.gameId ?? null;
    this.audibleKeys = audibleKeys;
    this.backgroundKeys = backgroundKeys;
    if (changed) {
      this.logFocus();
      this.requestPass();
    }
    this.updateTimer();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.inFlight) clearTimeout(this.inFlight.timeout);
    this.inFlight = null;
    const worker = this.worker;
    this.worker = null;
    if (!worker) return;
    // Best effort: hand back any game NXGS still has muted. The worker
    // finishes this line, then exits when its input closes.
    if (this.muted.size > 0) {
      const { ids, names } = splitKeys(this.muted);
      this.write(worker, { id: ++this.nextRequestId, mute: [], unmute: ids, muteNames: [], unmuteNames: names });
    }
    try {
      worker.stdin.end();
    } catch {
      // The worker already exited.
    }
  }

  private logFocus(): void {
    const describe = (audible: boolean) => this.targets
      .filter((target) => target.audible === audible && keysFor(target).length > 0)
      .map((target) => `${target.title} (${keysFor(target).join(', ')})`)
      .join('; ');
    const audibleGames = describe(true);
    const mutedGames = describe(false);
    if (!audibleGames && !mutedGames) return;
    void logLine(
      'info',
      `Game audio focus: ${audibleGames ? `playing ${audibleGames}` : 'no game on screen'}` +
        `${mutedGames ? `; muted ${mutedGames}` : ''}.`
    );
  }

  private updateTimer(): void {
    const hasWork = this.audibleKeys.size > 0 || this.backgroundKeys.size > 0 || this.muted.size > 0 || this.pendingPass;
    if (hasWork && !this.timer) {
      this.timer = setInterval(() => this.tick(), UNCONFIRMED_PASS_INTERVAL_MS);
    } else if (!hasWork && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    this.refresh();
    if (this.inFlight) return;
    const interval = this.audibleKeys.size > 0 && !this.audibleConfirmed
      ? UNCONFIRMED_PASS_INTERVAL_MS
      : STEADY_PASS_INTERVAL_MS;
    if (this.pendingPass || Date.now() - this.lastPassAt >= interval) this.requestPass();
  }

  private requestPass(): void {
    if (this.stopped) return;
    if (this.inFlight || Date.now() < this.retryAt) {
      // The tick after the reply or the retry delay sends it.
      this.pendingPass = true;
      return;
    }
    this.pendingPass = false;
    const released = [...this.muted].filter((key) => !this.backgroundKeys.has(key));
    const unmuteKeys = new Set([...this.audibleKeys, ...released]);
    const mute = splitKeys(this.backgroundKeys);
    const unmute = splitKeys(unmuteKeys);
    if (this.backgroundKeys.size === 0 && unmuteKeys.size === 0) {
      this.updateTimer();
      return;
    }
    let worker: ChildProcessWithoutNullStreams;
    try {
      worker = this.ensureWorker();
    } catch (error) {
      this.failPass(`could not start: ${String(error)}`, false);
      return;
    }
    const id = ++this.nextRequestId;
    this.lastPassAt = Date.now();
    const timeout = setTimeout(() => {
      if (this.inFlight?.id !== id) return;
      this.inFlight = null;
      this.failPass(this.workerAnswered ? 'did not respond in time' : 'did not start in time', true);
    }, this.workerAnswered ? REQUEST_TIMEOUT_MS : FIRST_REQUEST_TIMEOUT_MS);
    this.inFlight = { id, timeout, released, audibleGameId: this.audibleGameId, audibleKeys: [...this.audibleKeys] };
    // Record a mute before the reply: it must be released later even if the
    // game comes forward again before the worker answers.
    for (const key of this.backgroundKeys) this.muted.add(key);
    this.write(worker, { id, mute: mute.ids, unmute: unmute.ids, muteNames: mute.names, unmuteNames: unmute.names });
  }

  private handleReply(reply: AudioSessionReply): void {
    if (!this.inFlight || reply.id !== this.inFlight.id) return;
    const pass = this.inFlight;
    clearTimeout(pass.timeout);
    this.inFlight = null;
    this.workerAnswered = true;
    if (!reply.ok) {
      this.failPass(reply.message ?? 'unknown error', false);
      return;
    }
    if (this.failures > 0) void logLine('info', 'Game audio focus recovered.');
    this.failures = 0;
    this.retryAt = 0;
    this.lastFailure = '';
    // Forget a mute only once its release was applied, and only if the game
    // has not been sent to the background again since.
    for (const key of pass.released) {
      if (!this.backgroundKeys.has(key)) this.muted.delete(key);
    }
    if (pass.audibleGameId === this.audibleGameId &&
        pass.audibleKeys.some((key) => (reply.sessions?.[key] ?? 0) > 0)) {
      this.audibleConfirmed = true;
    }
    this.updateTimer();
  }

  private failPass(message: string, restartWorker: boolean): void {
    this.failures += 1;
    this.retryAt = Date.now() + Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** (this.failures - 1));
    this.pendingPass = true;
    const detail = this.stderrTail.trim();
    this.reportFailure(`${message}${detail ? ` (${detail})` : ''}`);
    if (restartWorker) this.stopWorker();
    this.updateTimer();
  }

  private reportFailure(message: string): void {
    if (message === this.lastFailure) return;
    this.lastFailure = message;
    void logLine('warn', `Game audio focus ${message}; retrying.`);
  }

  private write(worker: ChildProcessWithoutNullStreams, request: object): void {
    try {
      worker.stdin.write(`${JSON.stringify(request)}\n`);
    } catch {
      // A dead pipe is reported through the worker's error/exit handlers.
    }
  }

  private ensureWorker(): ChildProcessWithoutNullStreams {
    if (this.worker && !this.worker.killed && this.worker.exitCode === null) return this.worker;
    const worker = spawn(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        '[ScriptBlock]::Create($env:NXGS_GAME_AUDIO_WORKER).Invoke()'
      ],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NXGS_GAME_AUDIO_WORKER: WORKER_SCRIPT }
      }
    );
    this.worker = worker;
    this.workerAnswered = false;
    this.stdoutBuffer = '';
    this.stderrTail = '';
    worker.stdout.setEncoding('utf8');
    worker.stderr.setEncoding('utf8');
    worker.stderr.on('data', (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-600);
    });
    worker.stdout.on('data', (chunk: string) => {
      if (this.worker !== worker) return;
      this.stdoutBuffer += chunk;
      let newline = this.stdoutBuffer.indexOf('\n');
      while (newline >= 0) {
        const line = this.stdoutBuffer.slice(0, newline).trim();
        this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
        if (line) {
          try {
            this.handleReply(JSON.parse(line) as AudioSessionReply);
          } catch {
            // Ignore non-JSON PowerShell diagnostics; the request timeout reports failures.
          }
        }
        newline = this.stdoutBuffer.indexOf('\n');
      }
    });
    const forget = (reason: string) => {
      if (this.worker !== worker) return;
      this.worker = null;
      if (this.stopped) return;
      if (this.inFlight) {
        clearTimeout(this.inFlight.timeout);
        this.inFlight = null;
      }
      this.failPass(reason, false);
    };
    worker.stdin.on('error', (error) => forget(`input failed: ${error.message}`));
    worker.once('error', (error) => forget(`failed: ${error.message}`));
    worker.once('exit', (code) => forget(`stopped unexpectedly (exit ${String(code)})`));
    return worker;
  }

  private stopWorker(): void {
    const worker = this.worker;
    this.worker = null;
    if (!worker) return;
    try {
      worker.stdin.end();
    } catch {
      // The worker already exited.
    }
    worker.kill();
  }
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}
