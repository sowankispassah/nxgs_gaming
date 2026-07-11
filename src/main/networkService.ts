import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { NetworkStatus, WifiNetworkSummary } from '../shared/types';

const execFileAsync = promisify(execFile);

async function netsh(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('netsh.exe', args, {
    windowsHide: true,
    timeout: 10000,
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

function parseNetworks(output: string): WifiNetworkSummary[] {
  const networks: WifiNetworkSummary[] = [];
  let current: WifiNetworkSummary | null = null;
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    const ssid = line.match(/^SSID\s+\d+\s*:\s*(.*)$/i);
    if (ssid) {
      if (current?.ssid) networks.push(current);
      current = { ssid: ssid[1].trim() || 'Hidden network' };
      continue;
    }
    if (!current) continue;
    const signal = line.match(/^Signal\s*:\s*(.*)$/i);
    if (signal && !current.signal) current.signal = signal[1].trim();
    const auth = line.match(/^Authentication\s*:\s*(.*)$/i);
    if (auth && !current.security) current.security = auth[1].trim();
  }
  if (current?.ssid) networks.push(current);
  return networks.filter((network, index, all) => all.findIndex((item) => item.ssid === network.ssid) === index);
}

export async function getNetworkStatus(): Promise<NetworkStatus> {
  if (process.platform !== 'win32') {
    return { supported: false, connected: false, availableNetworks: [], message: 'Wi-Fi status is available on Windows.' };
  }

  try {
    const [interfaces, networks] = await Promise.all([
      netsh(['wlan', 'show', 'interfaces']),
      netsh(['wlan', 'show', 'networks', 'mode=bssid'])
    ]);
    const state = valueFor(interfaces, 'State')?.toLowerCase();
    return {
      supported: true,
      connected: state === 'connected',
      interfaceName: valueFor(interfaces, 'Name'),
      ssid: valueFor(interfaces, 'SSID'),
      signal: valueFor(interfaces, 'Signal'),
      availableNetworks: parseNetworks(networks),
      message: state === 'connected' ? undefined : 'Select a network in Windows once in-launcher connection setup is enabled.'
    };
  } catch (error) {
    return {
      supported: false,
      connected: false,
      availableNetworks: [],
      message: error instanceof Error ? error.message : String(error)
    };
  }
}
