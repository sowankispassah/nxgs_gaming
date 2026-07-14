import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import type {
  NetworkConnectivity,
  NetworkStatus,
  WifiActionResult,
  WifiConnectRequest,
  WifiNetworkSummary
} from '../shared/types';

const execFileAsync = promisify(execFile);

async function netsh(args: string[], timeout = 10000): Promise<string> {
  const { stdout } = await execFileAsync('netsh.exe', args, {
    windowsHide: true,
    timeout,
    maxBuffer: 2 * 1024 * 1024
  });
  return stdout;
}

function valueFor(output: string, label: string): string | undefined {
  const line = output.split(/\r?\n/).find((candidate) =>
    candidate.trimStart().toLowerCase().startsWith(`${label.toLowerCase()} `) ||
    candidate.trimStart().toLowerCase().startsWith(`${label.toLowerCase()}:`)
  );
  return line?.split(':').slice(1).join(':').trim() || undefined;
}

function isOpenSecurity(security?: string): boolean {
  return !security || /^(open|none)$/i.test(security.trim());
}

function parseSavedProfiles(output: string): Set<string> {
  const profiles = new Set<string>();
  for (const rawLine of output.split(/\r?\n/)) {
    const match = rawLine.match(/^\s*(?:All User Profile|Current User Profile)\s*:\s*(.+)$/i);
    if (match?.[1]) profiles.add(match[1].trim());
  }
  return profiles;
}

function parseNetworks(output: string, savedProfiles: Set<string>): WifiNetworkSummary[] {
  const networks: WifiNetworkSummary[] = [];
  let current: Partial<WifiNetworkSummary> | null = null;
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    const ssid = line.match(/^SSID\s+\d+\s*:\s*(.*)$/i);
    if (ssid) {
      if (current?.ssid) {
        networks.push({
          ssid: current.ssid,
          signal: current.signal,
          security: current.security,
          encryption: current.encryption,
          requiresPassword: !isOpenSecurity(current.security),
          saved: savedProfiles.has(current.ssid)
        });
      }
      current = ssid[1].trim() ? { ssid: ssid[1].trim() } : null;
      continue;
    }
    if (!current) continue;
    const signal = line.match(/^Signal\s*:\s*(.*)$/i);
    if (signal && (!current.signal || Number.parseInt(signal[1], 10) > Number.parseInt(current.signal, 10))) {
      current.signal = signal[1].trim();
    }
    const auth = line.match(/^Authentication\s*:\s*(.*)$/i);
    if (auth && !current.security) current.security = auth[1].trim();
    const encryption = line.match(/^Encryption\s*:\s*(.*)$/i);
    if (encryption && !current.encryption) current.encryption = encryption[1].trim();
  }
  if (current?.ssid) {
    networks.push({
      ssid: current.ssid,
      signal: current.signal,
      security: current.security,
      encryption: current.encryption,
      requiresPassword: !isOpenSecurity(current.security),
      saved: savedProfiles.has(current.ssid)
    });
  }
  return networks
    .filter((network, index, all) => all.findIndex((item) => item.ssid === network.ssid) === index)
    .sort((a, b) => Number.parseInt(b.signal ?? '0', 10) - Number.parseInt(a.signal ?? '0', 10));
}

async function getConnectivity(interfaceName?: string): Promise<NetworkConnectivity> {
  if (!interfaceName) return 'none';
  const script = `
$profile = Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceAlias -eq $env:NXGS_INTERFACE } | Select-Object -First 1
if ($null -eq $profile) { 'none' }
elseif ($profile.IPv4Connectivity -eq 'Internet' -or $profile.IPv6Connectivity -eq 'Internet') { 'internet' }
elseif ($profile.IPv4Connectivity -in @('LocalNetwork','Subnet') -or $profile.IPv6Connectivity -in @('LocalNetwork','Subnet')) { 'limited' }
else { 'none' }
`;
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 5000, env: { ...process.env, NXGS_INTERFACE: interfaceName } }
    );
    const result = stdout.trim().toLowerCase();
    return result === 'internet' || result === 'limited' || result === 'none' ? result : 'unknown';
  } catch {
    return 'unknown';
  }
}

function connectivityMessage(connectivity: NetworkConnectivity): string | undefined {
  if (connectivity === 'limited') return 'No internet / limited connection';
  if (connectivity === 'none') return 'Connected to Wi-Fi, but no internet access was detected.';
  return undefined;
}

export async function getNetworkStatus(): Promise<NetworkStatus> {
  if (process.platform !== 'win32') {
    return {
      supported: false,
      connected: false,
      connectivity: 'unknown',
      availableNetworks: [],
      message: 'Wi-Fi management is unavailable on this system.'
    };
  }

  try {
    const [interfaces, networks, profiles] = await Promise.all([
      netsh(['wlan', 'show', 'interfaces']),
      netsh(['wlan', 'show', 'networks', 'mode=bssid']),
      netsh(['wlan', 'show', 'profiles'])
    ]);
    const state = valueFor(interfaces, 'State')?.toLowerCase();
    const connected = state === 'connected';
    const interfaceName = valueFor(interfaces, 'Name');
    const connectivity = connected ? await getConnectivity(interfaceName) : 'none';
    return {
      supported: true,
      connected,
      interfaceName,
      ssid: connected ? valueFor(interfaces, 'SSID') : undefined,
      signal: connected ? valueFor(interfaces, 'Signal') : undefined,
      connectivity,
      availableNetworks: parseNetworks(networks, parseSavedProfiles(profiles)),
      message: connected ? connectivityMessage(connectivity) : 'Not connected'
    };
  } catch (error) {
    return {
      supported: false,
      connected: false,
      connectivity: 'unknown',
      availableNetworks: [],
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function xmlEscape(value: string): string {
  return value.replace(/[<>&"']/g, (character) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&apos;'
  })[character] ?? character);
}

function profileSecurity(network: WifiNetworkSummary, password?: string): { authentication: string; encryption: string; keyXml: string } {
  if (!network.requiresPassword) return { authentication: 'open', encryption: 'none', keyXml: '' };
  const security = network.security ?? '';
  const authentication = /WPA3/i.test(security) ? 'WPA3SAE' : /WPA(?!2|3)/i.test(security) ? 'WPAPSK' : 'WPA2PSK';
  const encryption = /GCMP/i.test(network.encryption ?? '') ? 'GCMP256' : /TKIP/i.test(network.encryption ?? '') ? 'TKIP' : 'AES';
  const keyType = password && /^[0-9a-f]{64}$/i.test(password) ? 'networkKey' : 'passPhrase';
  return {
    authentication,
    encryption,
    keyXml: `<sharedKey><keyType>${keyType}</keyType><protected>false</protected><keyMaterial>${xmlEscape(password ?? '')}</keyMaterial></sharedKey>`
  };
}

function createProfileXml(network: WifiNetworkSummary, password?: string): string {
  const security = profileSecurity(network, password);
  const ssid = xmlEscape(network.ssid);
  return `<?xml version="1.0"?><WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1"><name>${ssid}</name><SSIDConfig><SSID><name>${ssid}</name></SSID></SSIDConfig><connectionType>ESS</connectionType><connectionMode>auto</connectionMode><MSM><security><authEncryption><authentication>${security.authentication}</authentication><encryption>${security.encryption}</encryption><useOneX>false</useOneX></authEncryption>${security.keyXml}</security></MSM></WLANProfile>`;
}

function validateConnectRequest(request: WifiConnectRequest): string | undefined {
  if (!request || typeof request.ssid !== 'string' || request.ssid.length < 1 || request.ssid.length > 32) return 'Select a valid Wi-Fi network.';
  if (request.password !== undefined && typeof request.password !== 'string') return 'Enter a valid Wi-Fi password.';
  if (request.password && request.password.length > 64) return 'Wi-Fi passwords cannot exceed 64 characters.';
  return undefined;
}

async function waitForWifiState(expectedSsid?: string, attempts = 12): Promise<NetworkStatus> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const interfaces = await netsh(['wlan', 'show', 'interfaces']);
    const connected = valueFor(interfaces, 'State')?.toLowerCase() === 'connected';
    const ssid = connected ? valueFor(interfaces, 'SSID') : undefined;
    if ((expectedSsid && connected && ssid === expectedSsid) || (!expectedSsid && !connected)) break;
    await new Promise((resolve) => setTimeout(resolve, 850));
  }
  return getNetworkStatus();
}

export async function connectWifi(request: WifiConnectRequest): Promise<WifiActionResult> {
  const validationError = validateConnectRequest(request);
  if (validationError) {
    const network = await getNetworkStatus();
    return { ok: false, status: 'failed', message: validationError, network };
  }

  const before = await getNetworkStatus();
  const selected = before.availableNetworks.find((network) => network.ssid === request.ssid);
  if (!selected) {
    return { ok: false, status: 'failed', message: 'Network not found. Refresh the list and try again.', network: before };
  }
  if (selected.requiresPassword && !selected.saved && !request.password) {
    return { ok: false, status: 'incorrect-password', message: 'Password required', network: before };
  }
  if (selected.requiresPassword && !selected.saved && request.password && !(/^[0-9a-f]{64}$/i.test(request.password) || request.password.length >= 8)) {
    return { ok: false, status: 'incorrect-password', message: 'Wi-Fi passwords must contain at least 8 characters.', network: before };
  }

  let profilePath: string | undefined;
  try {
    if (!selected.saved || request.password) {
      profilePath = join(tmpdir(), `nxgs-wifi-${randomUUID()}.xml`);
      await writeFile(profilePath, createProfileXml(selected, request.password), { encoding: 'utf8', mode: 0o600 });
      await netsh([
        'wlan',
        'add',
        'profile',
        `filename=${profilePath}`,
        ...(before.interfaceName ? [`interface=${before.interfaceName}`] : []),
        'user=current'
      ]);
    }
    await netsh([
      'wlan',
      'connect',
      `name=${selected.ssid}`,
      `ssid=${selected.ssid}`,
      ...(before.interfaceName ? [`interface=${before.interfaceName}`] : [])
    ]);
    const network = await waitForWifiState(selected.ssid);
    if (network.connected && network.ssid === selected.ssid) {
      const message = connectivityMessage(network.connectivity) ?? 'Connected';
      return { ok: true, status: 'connected', message, network };
    }
    const stillVisible = network.availableNetworks.some((candidate) => candidate.ssid === selected.ssid);
    if (selected.requiresPassword && Boolean(request.password) && stillVisible) {
      return {
        ok: false,
        status: 'incorrect-password',
        message: 'Incorrect password or network authentication was rejected.',
        network
      };
    }
    return { ok: false, status: 'failed', message: 'Failed to connect. Move closer to the network and try again.', network };
  } catch (error) {
    const network = await getNetworkStatus();
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: 'failed', message: message.trim() || 'Failed to connect.', network };
  } finally {
    if (profilePath) await unlink(profilePath).catch(() => undefined);
  }
}

export async function disconnectWifi(): Promise<WifiActionResult> {
  const before = await getNetworkStatus();
  if (!before.connected) return { ok: true, status: 'disconnected', message: 'Wi-Fi is already disconnected.', network: before };
  try {
    await netsh(['wlan', 'disconnect', ...(before.interfaceName ? [`interface=${before.interfaceName}`] : [])]);
    const network = await waitForWifiState(undefined, 3);
    if (!network.connected) return { ok: true, status: 'disconnected', message: 'Disconnected', network };
    return { ok: false, status: 'failed', message: 'Wi-Fi could not be disconnected.', network };
  } catch (error) {
    const network = await getNetworkStatus();
    return {
      ok: false,
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
      network
    };
  }
}

export async function forgetWifi(ssid: string): Promise<WifiActionResult> {
  const before = await getNetworkStatus();
  if (typeof ssid !== 'string' || ssid.length < 1 || ssid.length > 32) {
    return { ok: false, status: 'failed', message: 'Select a valid saved Wi-Fi network.', network: before };
  }

  const selected = before.availableNetworks.find((network) => network.ssid === ssid);
  if (selected && !selected.saved) {
    return { ok: true, status: 'forgotten', message: `${ssid} is not saved.`, network: before };
  }

  try {
    await netsh([
      'wlan',
      'delete',
      'profile',
      `name=${ssid}`,
      ...(before.interfaceName ? [`interface=${before.interfaceName}`] : [])
    ]);
    const network = await getNetworkStatus();
    const stillSaved = network.availableNetworks.some((candidate) => candidate.ssid === ssid && candidate.saved);
    if (stillSaved) {
      return { ok: false, status: 'failed', message: 'The saved Wi-Fi network could not be removed.', network };
    }
    return {
      ok: true,
      status: 'forgotten',
      message: `Forgot ${ssid}. A password will be required the next time you connect.`,
      network
    };
  } catch (error) {
    const network = await getNetworkStatus();
    return {
      ok: false,
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
      network
    };
  }
}
