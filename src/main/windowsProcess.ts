import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function normalizeProcessName(processName: string): string {
  const trimmed = processName.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.toLowerCase().endsWith('.exe') ? trimmed : `${trimmed}.exe`;
}

export async function isProcessRunning(processName: string): Promise<boolean> {
  if (process.platform !== 'win32') {
    return false;
  }

  const normalized = normalizeProcessName(processName);
  if (!normalized) {
    return false;
  }

  try {
    const { stdout } = await execFileAsync('tasklist.exe', ['/FI', `IMAGENAME eq ${normalized}`, '/FO', 'CSV', '/NH'], {
      windowsHide: true
    });
    return stdout.toLowerCase().includes(normalized.toLowerCase());
  } catch {
    return false;
  }
}

export async function isProcessRunningByPid(pid: number): Promise<boolean> {
  if (process.platform !== 'win32' || !Number.isFinite(pid) || pid <= 0) {
    return false;
  }

  try {
    const { stdout } = await execFileAsync('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      windowsHide: true
    });
    return stdout.includes(String(pid));
  } catch {
    return false;
  }
}

export interface MicrosoftStoreProcessInfo {
  processId: number;
  processName: string;
  executablePath: string;
}

export async function waitForMicrosoftStoreProcess(
  appUserModelId: string,
  previousProcessIds: number[] = [],
  timeoutMs = 6000
): Promise<MicrosoftStoreProcessInfo | null> {
  if (process.platform !== 'win32' || !appUserModelId.trim()) {
    return null;
  }

  const script = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$aumid = $env:NXGS_STORE_AUMID
$aumidParts = $aumid -split '!', 2
$family = $aumidParts[0]
$applicationId = if ($aumidParts.Count -gt 1) { $aumidParts[1] } else { '' }
$previous = @(
  ($env:NXGS_STORE_PREVIOUS_PIDS -split ',') |
    Where-Object { $_ -match '^\d+$' } |
    ForEach-Object { [int]$_ }
)
$started = [DateTime]::UtcNow
$deadline = $started.AddMilliseconds([Math]::Max(250, [int]$env:NXGS_STORE_PROCESS_TIMEOUT))
$packages = @(Get-AppxPackage | Where-Object { $_.PackageFamilyName -eq $family })
$roots = @(
  $packages |
    ForEach-Object { $_.InstallLocation } |
    Where-Object { $_ } |
    ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\') + '\' }
)
if ($roots.Count -eq 0) { exit 0 }
$applicationPaths = @(
  foreach ($package in $packages) {
    try {
      $manifest = Get-AppxPackageManifest -Package $package
      $application = @($manifest.Package.Applications.Application) |
        Where-Object { [string]$_.Id -eq $applicationId } |
        Select-Object -First 1
      $executable = [string]$application.Executable
      if ($executable) {
        [IO.Path]::GetFullPath((Join-Path $package.InstallLocation $executable))
      }
    } catch {}
  }
)

$selected = $null
do {
  $matches = @(
    Get-CimInstance Win32_Process |
      Where-Object {
        $path = [string]$_.ExecutablePath
        if (-not $path) { return $false }
        if ($applicationPaths.Count -gt 0) {
          foreach ($applicationPath in $applicationPaths) {
            if ($path.Equals($applicationPath, [StringComparison]::OrdinalIgnoreCase)) { return $true }
          }
          return $false
        }
        foreach ($root in $roots) {
          if ($path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { return $true }
        }
        return $false
      } |
      Sort-Object CreationDate -Descending
  )
  $selected = $matches | Where-Object { $previous -notcontains [int]$_.ProcessId } | Select-Object -First 1
  if (-not $selected -and $matches.Count -gt 0 -and ([DateTime]::UtcNow - $started).TotalMilliseconds -ge 1200) {
    $selected = $matches | Select-Object -First 1
  }
  if (-not $selected) { Start-Sleep -Milliseconds 150 }
} while (-not $selected -and [DateTime]::UtcNow -lt $deadline)

if ($selected) {
  [pscustomobject]@{
    processId = [int]$selected.ProcessId
    processName = [string]$selected.Name
    executablePath = [string]$selected.ExecutablePath
  } | ConvertTo-Json -Compress
}
`;

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        windowsHide: true,
        timeout: Math.max(8000, timeoutMs + 4000),
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          NXGS_STORE_AUMID: appUserModelId.trim(),
          NXGS_STORE_PREVIOUS_PIDS: previousProcessIds.join(','),
          NXGS_STORE_PROCESS_TIMEOUT: String(timeoutMs)
        }
      }
    );
    if (!stdout.trim()) return null;
    const parsed = JSON.parse(stdout.trim()) as Partial<MicrosoftStoreProcessInfo>;
    if (!parsed.processId || !parsed.processName) return null;
    return {
      processId: Number(parsed.processId),
      processName: String(parsed.processName),
      executablePath: String(parsed.executablePath ?? '')
    };
  } catch {
    return null;
  }
}

export async function closeProcessByName(processName: string, force: boolean): Promise<void> {
  const normalized = normalizeProcessName(processName);
  if (!normalized) {
    return;
  }
  const args = ['/IM', normalized, '/T'];
  if (force) {
    args.push('/F');
  }
  await execFileAsync('taskkill.exe', args, { windowsHide: true });
}

export async function closeProcessByPid(pid: number, force: boolean): Promise<void> {
  const args = ['/PID', String(pid), '/T'];
  if (force) {
    args.push('/F');
  }
  await execFileAsync('taskkill.exe', args, { windowsHide: true });
}
