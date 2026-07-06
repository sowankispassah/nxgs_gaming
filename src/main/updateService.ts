import { app } from 'electron';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type {
  UpdateCheckResult,
  UpdateDownloadProgress,
  UpdateDownloadRequest,
  UpdateDownloadResult,
  UpdateInstallRequest
} from '../shared/types';
import { logLine } from './logger';

const OWNER = 'sowankispassah';
const REPO = 'nxgs_gaming';
const RELEASES_URL = `https://github.com/${OWNER}/${REPO}/releases`;
const LATEST_RELEASE_URL = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;
const UPDATE_MANIFEST_URL = `${RELEASES_URL}/latest/download/windows-update.json`;
const INSTALLER_ASSET_NAME = 'NXGS-Play-Setup.exe';

interface GitHubAsset {
  name?: string;
  browser_download_url?: string;
  digest?: string;
  size?: number;
}

interface GitHubRelease {
  tag_name?: string;
  html_url?: string;
  name?: string;
  assets?: GitHubAsset[];
}

interface UpdateManifest {
  version?: string;
  downloadUrl?: string;
  sha256?: string;
  required?: boolean;
  notes?: string;
  releaseUrl?: string;
}

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '');
}

function compareVersions(left: string, right: string): number {
  const leftParts = normalizeVersion(left).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = normalizeVersion(right).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue > rightValue) {
      return 1;
    }
    if (leftValue < rightValue) {
      return -1;
    }
  }

  return 0;
}

function validSha256(value?: string): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[0-9a-f]{64}$/.test(normalized) ? normalized : undefined;
}

function digestToSha256(digest?: string): string | undefined {
  return validSha256(digest?.replace(/^sha256:/i, ''));
}

function trustedHttpsUrl(value?: string): boolean {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'github.com' || url.hostname.endsWith('.githubusercontent.com'));
  } catch {
    return false;
  }
}

function assetNameFromUrl(value: string): string {
  try {
    return basename(decodeURIComponent(new URL(value).pathname));
  } catch {
    return INSTALLER_ASSET_NAME;
  }
}

function findInstallerAsset(assets: GitHubAsset[] = []): GitHubAsset | undefined {
  const exactMatch = assets.find((asset) => asset.name?.toLowerCase() === INSTALLER_ASSET_NAME.toLowerCase());
  if (exactMatch) {
    return exactMatch;
  }

  const setupInstaller = assets.find((asset) => {
    const assetName = asset.name?.toLowerCase() ?? '';
    return assetName.endsWith('setup.exe');
  });
  if (setupInstaller) {
    return setupInstaller;
  }

  return assets.find((asset) => asset.name?.toLowerCase().endsWith('.exe'));
}

function sanitizeAssetName(assetName?: string, latestVersion?: string): string {
  const fallbackName = latestVersion ? `NXGS-Play-Setup-${latestVersion}.exe` : INSTALLER_ASSET_NAME;
  const cleanName = basename(assetName || fallbackName).replace(/[<>:"/\\|?*]/g, '').trim();
  return cleanName.toLowerCase().endsWith('.exe') ? cleanName : fallbackName;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForFile(path: string, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await access(path);
      return true;
    } catch {
      await delay(250);
    }
  }
  return false;
}

function retryableDownloadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /terminated|fetch failed|network|socket|econnreset|etimedout|timeout|aborted/i.test(message);
}

function isProgramFilesInstall(exePath: string): boolean {
  const normalized = exePath.toLowerCase();
  const programFiles = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
    .filter(Boolean)
    .map((path) => `${path?.toLowerCase().replace(/[\\/]$/, '')}\\`);
  return programFiles.some((path) => normalized.startsWith(path));
}

function commandProcessorPath(): string {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  return process.env.ComSpec || join(systemRoot, 'System32', 'cmd.exe');
}

function cmdSetValue(value: string): string {
  return value
    .replace(/\^/g, '^^')
    .replace(/%/g, '%%')
    .replace(/&/g, '^&')
    .replace(/\|/g, '^|')
    .replace(/</g, '^<')
    .replace(/>/g, '^>')
    .replace(/"/g, '');
}

async function spawnDetached(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    let settled = false;

    child.once('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    child.once('spawn', () => {
      if (!settled) {
        settled = true;
        child.unref();
        resolve();
      }
    });
  });
}

function buildResultFromManifest(manifest: UpdateManifest, currentVersion: string, checkedAt: string): UpdateCheckResult {
  const latestVersion = normalizeVersion(manifest.version ?? '');
  if (!latestVersion) {
    throw new Error('Update manifest version is missing.');
  }

  const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
  const sha256 = validSha256(manifest.sha256);
  const canDownload = Boolean(updateAvailable && trustedHttpsUrl(manifest.downloadUrl) && sha256);

  return {
    status: updateAvailable ? 'available' : 'latest',
    currentVersion,
    latestVersion,
    releaseUrl: manifest.releaseUrl || `${RELEASES_URL}/latest`,
    assetName: manifest.downloadUrl ? assetNameFromUrl(manifest.downloadUrl) : INSTALLER_ASSET_NAME,
    downloadUrl: canDownload ? manifest.downloadUrl : undefined,
    sha256,
    required: Boolean(manifest.required),
    notes: manifest.notes,
    source: 'manifest',
    canDownload,
    message: updateAvailable
      ? canDownload
        ? 'New update available. Download it now, then restart when you are ready.'
        : 'New update found, but the update manifest is missing a secure installer URL or checksum.'
      : 'You are on the latest version.',
    checkedAt
  };
}

async function checkManifest(currentVersion: string, checkedAt: string): Promise<UpdateCheckResult | null> {
  const response = await fetch(UPDATE_MANIFEST_URL, {
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
      'User-Agent': `NXGS-Play/${currentVersion}`
    }
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Update manifest returned ${response.status} ${response.statusText}`);
  }

  const manifest = (await response.json()) as UpdateManifest;
  return buildResultFromManifest(manifest, currentVersion, checkedAt);
}

async function checkGitHubRelease(currentVersion: string, checkedAt: string): Promise<UpdateCheckResult> {
  const response = await fetch(LATEST_RELEASE_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'Cache-Control': 'no-cache',
      'User-Agent': `NXGS-Play/${currentVersion}`
    }
  });

  if (response.status === 404) {
    return {
      status: 'failed',
      currentVersion,
      message:
        'No GitHub Release is published yet. Pushed code is not installable until a release with the Windows installer is published.',
      checkedAt
    };
  }

  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status} ${response.statusText}`);
  }

  const release = (await response.json()) as GitHubRelease;
  const latestVersion = normalizeVersion(release.tag_name ?? release.name ?? '');
  if (!latestVersion) {
    throw new Error('Latest release did not include a version tag.');
  }

  const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
  const installerAsset = findInstallerAsset(release.assets);
  const sha256 = digestToSha256(installerAsset?.digest);
  const downloadUrl = installerAsset?.browser_download_url;
  const canDownload = Boolean(updateAvailable && downloadUrl && trustedHttpsUrl(downloadUrl) && sha256);

  return {
    status: updateAvailable ? 'available' : 'latest',
    currentVersion,
    latestVersion,
    releaseUrl: release.html_url,
    assetName: installerAsset?.name,
    downloadUrl: canDownload ? downloadUrl : undefined,
    sha256,
    source: 'github-release',
    canDownload,
    message: updateAvailable
      ? canDownload
        ? 'New update available. Download it now, then restart when you are ready.'
        : 'New release found, but the installer asset or checksum could not be read.'
      : 'You are on the latest version.',
    checkedAt
  };
}

async function writeChunk(stream: ReturnType<typeof createWriteStream>, chunk: Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.write(chunk, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function closeStream(stream: ReturnType<typeof createWriteStream>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.end((error?: Error | null) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function sha256File(path: string): Promise<string> {
  const { createReadStream } = await import('node:fs');
  const hash = createHash('sha256');
  const stream = createReadStream(path);

  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk) => {
      hash.update(chunk);
    });
    stream.on('error', reject);
    stream.on('end', resolve);
  });

  return hash.digest('hex');
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion();
  const checkedAt = new Date().toISOString();

  try {
    const manifestResult = await checkManifest(currentVersion, checkedAt);
    if (manifestResult) {
      return manifestResult;
    }

    return await checkGitHubRelease(currentVersion, checkedAt);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logLine('warn', `Update check failed: ${message}`);
    return {
      status: 'failed',
      currentVersion,
      message: `Update check failed: ${message}`,
      checkedAt
    };
  }
}

export async function downloadUpdate(
  request: UpdateDownloadRequest,
  onProgress?: (progress: UpdateDownloadProgress) => void
): Promise<UpdateDownloadResult> {
  const expectedSha256 = validSha256(request.sha256);
  const assetName = sanitizeAssetName(request.assetName, request.latestVersion);
  const updatesDirectory = join(app.getPath('temp'), 'NXGS Play Updates');
  const installerPath = join(updatesDirectory, assetName);
  const partPath = `${installerPath}.part`;
  let stream: ReturnType<typeof createWriteStream> | null = null;

  try {
    if (!trustedHttpsUrl(request.downloadUrl)) {
      throw new Error('Update download URL is not a trusted HTTPS URL.');
    }

    await mkdir(updatesDirectory, { recursive: true });
    await rm(installerPath, { force: true });

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await rm(partPath, { force: true });

        const response = await fetch(request.downloadUrl, {
          headers: {
            'Cache-Control': 'no-cache',
            'User-Agent': `NXGS-Play/${app.getVersion()}`
          }
        });

        if (!response.ok) {
          throw new Error(`Download returned ${response.status} ${response.statusText}`);
        }

        if (!response.body) {
          throw new Error('Update download did not include a response body.');
        }

        const totalBytes = Number(response.headers.get('content-length') || 0) || undefined;
        const hash = createHash('sha256');
        const reader = response.body.getReader();
        stream = createWriteStream(partPath, { flags: 'wx' });
        let receivedBytes = 0;

        onProgress?.({ receivedBytes, totalBytes, percent: 0 });

        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }

          const chunk = Buffer.from(value);
          receivedBytes += chunk.length;
          hash.update(chunk);
          await writeChunk(stream, chunk);

          const percent = totalBytes ? Math.min(99, Math.round((receivedBytes / totalBytes) * 100)) : 0;
          onProgress?.({ receivedBytes, totalBytes, percent });
        }

        await closeStream(stream);
        stream = null;

        const actualSha256 = hash.digest('hex');
        if (expectedSha256 && actualSha256 !== expectedSha256) {
          throw new Error('The downloaded installer failed checksum verification.');
        }

        await rename(partPath, installerPath);
        onProgress?.({ receivedBytes, totalBytes, percent: 100 });
        await logLine('info', `Downloaded verified update installer to ${installerPath}`);

        return {
          ok: true,
          installerPath,
          message: `Update downloaded. Restart when you are ready to install ${request.latestVersion ?? 'the new version'}.`
        };
      } catch (error) {
        if (stream) {
          stream.destroy();
          stream = null;
        }
        await rm(partPath, { force: true }).catch(() => undefined);

        if (attempt < 3 && retryableDownloadError(error)) {
          const message = error instanceof Error ? error.message : String(error);
          await logLine('warn', `Update download attempt ${attempt} failed: ${message}; retrying.`);
          await delay(attempt * 1000);
          continue;
        }

        throw error;
      }
    }

    throw new Error('Update download failed after multiple attempts.');
  } catch (error) {
    await rm(partPath, { force: true }).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    await logLine('error', `Update download failed: ${message}`);
    return {
      ok: false,
      message
    };
  }
}

export async function startUpdateInstaller(request: UpdateInstallRequest): Promise<UpdateDownloadResult> {
  try {
    if (!request.installerPath.toLowerCase().endsWith('.exe')) {
      throw new Error('Update installer must be a Windows .exe file.');
    }

    await access(request.installerPath);

    const expectedSha256 = validSha256(request.sha256);
    if (expectedSha256) {
      const actualSha256 = await sha256File(request.installerPath);
      if (actualSha256 !== expectedSha256) {
        throw new Error('The installer checksum no longer matches.');
      }
    }

    const currentExePath = app.getPath('exe');
    const updatesDirectory = join(app.getPath('temp'), 'NXGS Play Updates');
    const helperPath = join(updatesDirectory, 'install-update.cmd');
    const helperLogPath = join(updatesDirectory, 'install-update.log');
    const helperStartedPath = join(updatesDirectory, 'install-update.started');
    const requiresElevation = isProgramFilesInstall(currentExePath);
    const installerArguments = requiresElevation ? '/S /allusers' : '/S /currentuser';
    const script = [
      '@echo off',
      'setlocal DisableDelayedExpansion',
      `set "pidToWait=${process.pid}"`,
      `set "installer=${cmdSetValue(request.installerPath)}"`,
      `set "appPath=${cmdSetValue(currentExePath)}"`,
      `set "installArgs=${cmdSetValue(installerArguments)}"`,
      `set "logPath=${cmdSetValue(helperLogPath)}"`,
      `set "startedPath=${cmdSetValue(helperStartedPath)}"`,
      'if not exist "%~dp0" mkdir "%~dp0" >nul 2>nul',
      '> "%startedPath%" echo %date% %time%',
      '>> "%logPath%" echo %date% %time% Update helper started.',
      '>> "%logPath%" echo %date% %time% Current app path: "%appPath%"',
      '>> "%logPath%" echo %date% %time% Waiting for NXGS Play process %pidToWait% to exit.',
      'ping 127.0.0.1 -n 4 >nul',
      '>> "%logPath%" echo %date% %time% Ensuring old NXGS Play process is closed.',
      'taskkill /PID %pidToWait% /T /F >nul 2>nul',
      'ping 127.0.0.1 -n 2 >nul',
      '>> "%logPath%" echo %date% %time% Starting installer: "%installer%" %installArgs%',
      'start "" /wait "%installer%" %installArgs%',
      'set "exitCode=%ERRORLEVEL%"',
      '>> "%logPath%" echo %date% %time% Installer finished with exit code %exitCode%.',
      'ping 127.0.0.1 -n 2 >nul',
      'if exist "%appPath%" (',
      '  >> "%logPath%" echo %date% %time% Relaunching "%appPath%".',
      '  start "" "%appPath%"',
      ') else (',
      '  >> "%logPath%" echo %date% %time% App relaunch skipped because app path is missing.',
      ')',
      'exit /b %exitCode%'
    ].join('\r\n');

    await mkdir(updatesDirectory, { recursive: true });
    await rm(helperStartedPath, { force: true });
    await rm(helperLogPath, { force: true });
    await writeFile(helperPath, script, 'utf8');

    await logLine('info', `Starting update helper ${helperPath}`);
    await spawnDetached(commandProcessorPath(), ['/d', '/c', helperPath]);

    const helperStarted = await waitForFile(helperStartedPath, 10000);
    if (!helperStarted) {
      const message = 'The update installer helper did not start. NXGS Play stayed open so you can try again.';
      await logLine('error', `Update install failed: ${message}`);
      return {
        ok: false,
        message
      };
    }

    await logLine(
      'info',
      `Started update restart helper for ${request.installerPath}. Helper log: ${helperLogPath}`
    );
    return {
      ok: true,
      installerPath: request.installerPath,
      message: isProgramFilesInstall(currentExePath)
        ? 'Restarting NXGS Play to install the update. Approve the Windows permission prompt if it appears.'
        : 'Restarting NXGS Play to install the update.'
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logLine('error', `Update install failed: ${message}`);
    return {
      ok: false,
      message
    };
  }
}
