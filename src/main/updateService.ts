import { app } from 'electron';
import type { UpdateCheckResult } from '../shared/types';
import { logLine } from './logger';

const OWNER = 'sowankispassah';
const REPO = 'nxgs_gaming';
const LATEST_RELEASE_URL = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;

interface GitHubRelease {
  tag_name?: string;
  html_url?: string;
  name?: string;
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
        status: 'latest',
        currentVersion,
        message: 'You are on the latest version. No GitHub release is published yet.',
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
    return {
      status: updateAvailable ? 'available' : 'latest',
      currentVersion,
      latestVersion,
      releaseUrl: release.html_url,
      message: updateAvailable ? 'New update available.' : 'You are on the latest version.',
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
