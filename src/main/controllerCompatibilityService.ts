import { app } from 'electron';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ControllerCompatibilityDiagnostics, GameRecord } from '../shared/types';
import { logLine } from './logger';

const execFileAsync = promisify(execFile);
const BRIDGE_VERSION = 'ds4windows-3.5-nxgs-5';
const DS4WINDOWS_EXE_SHA256 = '6267cba17b87ada8f13ec6e187b309e3c76aa087acf2c255ab19dc2db6799a34';
const DS4WINDOWS_DLL_SHA256 = 'bd7497e24cfcededa70683fa58c738901e4ca86c1d8ec98567a971faf03ebffd';
const DRIVER_REGISTRY_KEY =
  'HKLM\\SOFTWARE\\WOW6432Node\\Nefarius Software Solutions e.U.\\ViGEm Bus Driver';
const STARTUP_WAIT_MS = 14_000;
const HEALTH_INTERVAL_MS = 15_000;
const DEFAULT_PROFILE = 'Default';
const CHICKEN_INVADERS_PROFILE = 'Chicken Invaders 4';
const CHICKEN_INVADERS_AUMID = 'f7e879f5.chickeninvaders4_m9yrg34ad3crj!app';

type XInputProbe = {
  connected: boolean;
  slots: Array<{ index: number; connected: boolean; result: number }>;
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

export class ControllerCompatibilityService {
  private mapper: ChildProcess | null = null;
  private activeProfile = DEFAULT_PROFILE;
  private healthTimer: NodeJS.Timeout | null = null;
  private startPromise: Promise<ControllerCompatibilityDiagnostics> | null = null;
  private status: ControllerCompatibilityDiagnostics = {
    status: process.platform === 'win32' ? 'idle' : 'unavailable',
    driverInstalled: false,
    mapperRunning: false,
    xinputReady: false,
    message: process.platform === 'win32' ? 'Controller compatibility is ready to initialize.' : 'Windows only.'
  };

  get diagnostics(): ControllerCompatibilityDiagnostics {
    return { ...this.status };
  }

  async prepare(): Promise<ControllerCompatibilityDiagnostics> {
    if (process.platform !== 'win32') return this.diagnostics;
    try {
      const runtimeDirectory = await this.ensureRuntime();
      await this.validateMapper(runtimeDirectory);
      const driverInstalled = await this.isDriverInstalled();
      this.setStatus({
        status: driverInstalled ? 'idle' : 'driverRequired',
        driverInstalled,
        mapperRunning: false,
        xinputReady: false,
        message: driverInstalled
          ? 'Starts automatically when a game launches or resumes.'
          : 'The virtual controller driver will be installed when gameplay starts.'
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus({
        status: 'error',
        mapperRunning: false,
        xinputReady: false,
        lastError: message,
        message
      });
      await logLine('error', `Controller compatibility preparation failed: ${message}`);
    }
    return this.diagnostics;
  }

  start(options: { allowDriverInstall?: boolean } = {}): Promise<ControllerCompatibilityDiagnostics> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal(Boolean(options.allowDriverInstall)).finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  async ensureReady(): Promise<ControllerCompatibilityDiagnostics> {
    const result = await this.start({ allowDriverInstall: app.isPackaged });
    if (result.xinputReady) return result;
    if (result.status === 'waitingForController') return this.waitForXInput(10_000);
    return this.waitForXInput(STARTUP_WAIT_MS);
  }

  async ensureReadyForGame(game: GameRecord): Promise<ControllerCompatibilityDiagnostics> {
    const desiredProfile = this.profileForGame(game);
    if (desiredProfile !== DEFAULT_PROFILE && this.mapper && !this.mapper.killed && this.activeProfile === desiredProfile) {
      return this.refreshHealth();
    }

    if (this.activeProfile !== DEFAULT_PROFILE && desiredProfile === DEFAULT_PROFILE) {
      await this.loadTemporaryProfile(DEFAULT_PROFILE);
    }

    const result = await this.ensureReady();
    if (desiredProfile === DEFAULT_PROFILE || !result.mapperRunning || result.status !== 'ready') return result;

    await this.loadTemporaryProfile(desiredProfile);
    return this.refreshHealth();
  }

  stop(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    const mapper = this.mapper;
    this.mapper = null;
    this.activeProfile = DEFAULT_PROFILE;
    if (mapper && !mapper.killed) {
      mapper.kill();
    }
    this.status = {
      ...this.status,
      mapperRunning: false,
      xinputReady: false,
      status: process.platform === 'win32' ? 'idle' : 'unavailable',
      message: 'Starts automatically when a game launches or resumes.'
    };
  }

  private async startInternal(allowDriverInstall: boolean): Promise<ControllerCompatibilityDiagnostics> {
    if (process.platform !== 'win32') return this.diagnostics;

    if (this.mapper && !this.mapper.killed) {
      return this.refreshHealth();
    }

    this.setStatus({
      status: 'starting',
      mapperRunning: false,
      xinputReady: false,
      message: 'Preparing PlayStation controller compatibility...'
    });

    try {
      const runtimeDirectory = await this.ensureRuntime();
      let driverInstalled = await this.isDriverInstalled();
      this.setStatus({ driverInstalled });
      if (!driverInstalled && allowDriverInstall) {
        this.setStatus({
          status: 'installingDriver',
          message: 'Installing the signed virtual controller driver...'
        });
        await this.installDriver(runtimeDirectory);
        driverInstalled = await this.isDriverInstalled();
        this.setStatus({ driverInstalled });
      }

      if (!driverInstalled) {
        this.setStatus({
          status: 'driverRequired',
          mapperRunning: false,
          xinputReady: false,
          message: 'The virtual controller driver is not installed.'
        });
        await logLine('warn', 'Controller compatibility is unavailable because ViGEmBus is not installed.');
        return this.diagnostics;
      }

      await this.validateMapper(runtimeDirectory);
      this.launchMapper(runtimeDirectory);
      const result = await this.waitForXInput(STARTUP_WAIT_MS);
      this.startHealthMonitor();
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus({
        status: 'error',
        mapperRunning: false,
        xinputReady: false,
        lastError: message,
        message
      });
      await logLine('error', `Controller compatibility failed: ${message}`);
      return this.diagnostics;
    }
  }

  private sourceDirectory(): string {
    return app.isPackaged
      ? join(process.resourcesPath, 'controller-bridge')
      : join(app.getAppPath(), 'vendor', 'controller-bridge');
  }

  private runtimeDirectory(): string {
    return join(app.getPath('userData'), 'controller-bridge', BRIDGE_VERSION);
  }

  private async ensureRuntime(): Promise<string> {
    const source = this.sourceDirectory();
    const runtime = this.runtimeDirectory();
    const marker = join(runtime, '.nxgs-controller-bridge-version');
    try {
      if (
        (await readFile(marker, 'utf8')).trim() === BRIDGE_VERSION &&
        (await sha256(join(runtime, 'DS4Windows.exe'))) === DS4WINDOWS_EXE_SHA256 &&
        (await sha256(join(runtime, 'DS4Windows.dll'))) === DS4WINDOWS_DLL_SHA256
      ) {
        return runtime;
      }
    } catch {
      // Copy a fresh validated runtime below.
    }

    await mkdir(runtime, { recursive: true });
    await cp(source, runtime, { recursive: true, force: true });
    await writeFile(marker, `${BRIDGE_VERSION}\n`, 'utf8');
    return runtime;
  }

  private async validateMapper(runtimeDirectory: string): Promise<void> {
    const executableHash = await sha256(join(runtimeDirectory, 'DS4Windows.exe'));
    const assemblyHash = await sha256(join(runtimeDirectory, 'DS4Windows.dll'));
    if (executableHash !== DS4WINDOWS_EXE_SHA256 || assemblyHash !== DS4WINDOWS_DLL_SHA256) {
      throw new Error('Controller mapper failed integrity validation.');
    }
  }

  private async isDriverInstalled(): Promise<boolean> {
    try {
      await execFileAsync('reg.exe', ['query', DRIVER_REGISTRY_KEY, '/v', 'Version'], {
        windowsHide: true,
        timeout: 3000
      });
      return true;
    } catch {
      return false;
    }
  }

  private async installDriver(runtimeDirectory: string): Promise<void> {
    const script = join(runtimeDirectory, 'install-driver.ps1');
    const installer = join(runtimeDirectory, 'ViGEmBus_1.22.0_x64_x86_arm64.exe');
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Installer', installer],
      { windowsHide: true, timeout: 180_000 }
    );
  }

  private launchMapper(runtimeDirectory: string): void {
    const executable = join(runtimeDirectory, 'DS4Windows.exe');
    const mapper = spawn(executable, ['-m'], {
      cwd: runtimeDirectory,
      windowsHide: true,
      stdio: 'ignore'
    });
    this.mapper = mapper;
    this.activeProfile = DEFAULT_PROFILE;
    this.setStatus({
      status: 'starting',
      mapperRunning: true,
      message: 'Starting the virtual Xbox controller...'
    });
    void logLine('info', `Controller compatibility mapper started (process ${mapper.pid ?? 'unknown'}).`);
    mapper.once('exit', (code, signal) => {
      if (this.mapper !== mapper) return;
      this.mapper = null;
      this.activeProfile = DEFAULT_PROFILE;
      this.setStatus({
        mapperRunning: false,
        xinputReady: false,
        status: 'error',
        message: `Controller mapper stopped unexpectedly (${code ?? signal ?? 'unknown'}).`
      });
      void logLine('warn', `Controller compatibility mapper exited (${code ?? signal ?? 'unknown'}).`);
    });
  }

  private async waitForXInput(timeout: number): Promise<ControllerCompatibilityDiagnostics> {
    const deadline = Date.now() + timeout;
    do {
      const probe = await this.probeXInput();
      if (probe.connected) {
        this.setStatus({
          status: 'ready',
          driverInstalled: true,
          mapperRunning: Boolean(this.mapper && !this.mapper.killed),
          xinputReady: true,
          lastError: undefined,
          message: 'PlayStation controller is available to games as an Xbox controller.'
        });
        await logLine('info', 'Controller compatibility confirmed an active XInput controller.');
        return this.diagnostics;
      }
      if (!this.mapper || this.mapper.killed) break;
      await delay(500);
    } while (Date.now() < deadline);

    this.setStatus({
      status: this.mapper && !this.mapper.killed ? 'waitingForController' : 'error',
      mapperRunning: Boolean(this.mapper && !this.mapper.killed),
      xinputReady: false,
      message:
        this.mapper && !this.mapper.killed
          ? 'Controller mapper is ready and waiting for a PlayStation controller.'
          : 'Controller mapper is not running.'
    });
    return this.diagnostics;
  }

  private async probeXInput(): Promise<XInputProbe> {
    const runtime = this.runtimeDirectory();
    try {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(runtime, 'probe-xinput.ps1')],
        { windowsHide: true, timeout: 5000, maxBuffer: 16 * 1024 }
      );
      return JSON.parse(stdout.trim()) as XInputProbe;
    } catch (error) {
      await logLine('warn', `XInput compatibility probe failed: ${String(error)}`);
      return { connected: false, slots: [] };
    }
  }

  private async refreshHealth(): Promise<ControllerCompatibilityDiagnostics> {
    const mapperRunning = Boolean(this.mapper && !this.mapper.killed);
    if (mapperRunning && this.activeProfile !== DEFAULT_PROFILE) {
      this.setStatus({
        status: 'ready',
        mapperRunning: true,
        xinputReady: false,
        lastError: undefined,
        message: `${this.activeProfile} keyboard controller profile is active.`
      });
      return this.diagnostics;
    }

    const probe = await this.probeXInput();
    this.setStatus({
      status: probe.connected ? 'ready' : mapperRunning ? 'waitingForController' : 'error',
      mapperRunning,
      xinputReady: probe.connected,
      message: probe.connected
        ? 'PlayStation controller is available to games as an Xbox controller.'
        : mapperRunning
          ? 'Controller mapper is waiting for a PlayStation controller.'
          : 'Controller mapper is not running.'
    });
    return this.diagnostics;
  }

  private profileForGame(game: GameRecord): string {
    return game.launchType === 'microsoftStore' && game.launchCommand.trim().toLowerCase() === CHICKEN_INVADERS_AUMID
      ? CHICKEN_INVADERS_PROFILE
      : DEFAULT_PROFILE;
  }

  private async loadTemporaryProfile(profileName: string): Promise<void> {
    const runtime = this.runtimeDirectory();
    const executable = join(runtime, 'DS4Windows.exe');
    await execFileAsync(executable, ['-command', `LoadTempProfile.1.${profileName}`], {
      cwd: runtime,
      windowsHide: true,
      timeout: 5_000
    });
    let activeProfile = '';
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await delay(250);
      const { stdout } = await execFileAsync(executable, ['-command', 'Query.1.ProfileName'], {
        cwd: runtime,
        windowsHide: true,
        timeout: 5_000,
        maxBuffer: 4 * 1024
      });
      activeProfile = stdout.trim();
      if (activeProfile.localeCompare(profileName, undefined, { sensitivity: 'accent' }) === 0) break;
    }
    if (activeProfile.localeCompare(profileName, undefined, { sensitivity: 'accent' }) !== 0) {
      throw new Error(`Controller mapper did not activate the required ${profileName} profile (reported: ${activeProfile || 'none'}).`);
    }
    this.activeProfile = profileName;
    await logLine('info', `Controller compatibility activated and verified profile "${profileName}" for controller 1.`);
  }

  private startHealthMonitor(): void {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = setInterval(() => {
      void this.refreshHealth();
    }, HEALTH_INTERVAL_MS);
  }

  private setStatus(update: Partial<ControllerCompatibilityDiagnostics>): void {
    this.status = {
      ...this.status,
      ...update,
      updatedAt: new Date().toISOString()
    };
  }
}
