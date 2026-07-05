import { app } from 'electron';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { spawn } from 'node:child_process';
import type { UpdateCheckResult, UpdateDownloadRequest, UpdateDownloadResult, UpdateInstallRequest } from '../shared/types';
import { logLine } from './logger';

const OWNER = 'sowankispassah';
const REPO = 'nxgs_gaming';
const LATEST_RELEASE_URL = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;
const INSTALLER_ASSET_NAME = 'NXGS Play Setup.exe';

interface GitHubAsset {
  name?: string;
  browser_download_url?: string;
  size?: number;
}

interface GitHubRelease {
  tag_name?: string;
  html_url?: string;
  name?: string;
  assets?: GitHubAsset[];
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

function findInstallerAsset(assets: GitHubAsset[] = []): GitHubAsset | undefined {
  const exactMatch = assets.find((asset) => asset.name?.toLowerCase() === INSTALLER_ASSET_NAME.toLowerCase());
  if (exactMatch) {
    return exactMatch;
  }

  return assets.find((asset) => {
    const assetName = asset.name?.toLowerCase() ?? '';
    return assetName.endsWith('setup.exe') || assetName.endsWith('.exe');
  });
}

function sanitizeAssetName(assetName?: string): string {
  const cleanName = basename(assetName || INSTALLER_ASSET_NAME).replace(/[<>:"/\\|?*]/g, '').trim();
  return cleanName || INSTALLER_ASSET_NAME;
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion();
  const checkedAt = new Date().toISOString();

  try {
    const response = await fetch(LATEST_RELEASE_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
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
    const canDownload = Boolean(updateAvailable && installerAsset?.browser_download_url);

    return {
      status: updateAvailable ? 'available' : 'latest',
      currentVersion,
      latestVersion,
      releaseUrl: release.html_url,
      assetName: installerAsset?.name,
      downloadUrl: canDownload ? installerAsset?.browser_download_url : undefined,
      canDownload,
      message: updateAvailable
        ? canDownload
          ? 'New update available. Download the Windows installer to update NXGS Play.'
          : 'New release found, but no Windows installer asset is attached to the GitHub Release.'
        : 'You are on the latest version.',
      checkedAt
    };
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

export async function downloadUpdate(request: UpdateDownloadRequest): Promise<UpdateDownloadResult> {
  try {
    if (!request.downloadUrl || !request.downloadUrl.startsWith('https://github.com/')) {
      throw new Error('Update download URL is not a trusted GitHub release asset.');
    }

    const assetName = sanitizeAssetName(request.assetName);
    const updatesDirectory = join(app.getPath('userData'), 'updates');
    const installerPath = join(updatesDirectory, assetName);

    await mkdir(updatesDirectory, { recursive: true });
    const response = await fetch(request.downloadUrl, {
      headers: {
        'User-Agent': `NXGS-Play/${app.getVersion()}`
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub returned ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      throw new Error('Downloaded installer was empty.');
    }

    await writeFile(installerPath, buffer);
    await logLine('info', `Downloaded update installer to ${installerPath}`);

    return {
      ok: true,
      installerPath,
      message: `Downloaded ${assetName}.`
    };
  } catch (error) {
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
    const child = spawn(request.installerPath, [], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();

    await logLine('info', `Started update installer ${request.installerPath}`);
    return {
      ok: true,
      installerPath: request.installerPath,
      message: 'Update installer started. NXGS Play will close so the installer can replace the app files.'
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
