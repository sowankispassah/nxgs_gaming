param(
    [string]$MsysRoot = "C:\msys64",
    [string]$BuildDir = "build-local-msys2",
    [string]$OutputDir = "release\NXGS-Gaming-Win",
    [switch]$Setup,
    [switch]$Clean,
    [switch]$Launch
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$MsysRoot = [System.IO.Path]::GetFullPath($MsysRoot)
$Bash = Join-Path $MsysRoot "usr\bin\bash.exe"
$OutputPath = Join-Path $RepoRoot $OutputDir
$AppExe = Join-Path $OutputPath "NXGS Gaming.exe"

if ($Setup -or -not (Test-Path -LiteralPath $Bash)) {
    & (Join-Path $PSScriptRoot "setup-local-msys2.ps1") -MsysRoot $MsysRoot
}

if (-not (Test-Path -LiteralPath $Bash)) {
    throw "Could not find MSYS2 bash at $Bash"
}

function Invoke-Msys2 {
    param([Parameter(Mandatory = $true)][string]$Command)
    & $Bash -lc "export MSYSTEM=MINGW64; export CHERE_INVOKING=1; source /etc/profile; $Command"
    if ($LASTEXITCODE -ne 0) {
        throw "MSYS2 command failed with exit code ${LASTEXITCODE}: $Command"
    }
}

function ConvertTo-MsysPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    $converted = (& $Bash -lc "cygpath -u '$($Path -replace '\\', '\\')'").Trim()
    if ($LASTEXITCODE -ne 0 -or -not $converted) {
        throw "Failed to convert path for MSYS2: $Path"
    }
    return $converted
}

function Stop-OutputProcesses {
    if (-not (Test-Path -LiteralPath $OutputPath)) {
        return
    }
    $resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
    Get-CimInstance Win32_Process |
        Where-Object {
            $_.ExecutablePath -and
            ([System.IO.Path]::GetFullPath($_.ExecutablePath)).StartsWith($resolvedOutput, [System.StringComparison]::OrdinalIgnoreCase)
        } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}

$RepoMsys = ConvertTo-MsysPath $RepoRoot.Path

if ($Clean) {
    $BuildPath = Join-Path $RepoRoot $BuildDir
    $resolvedBuild = [System.IO.Path]::GetFullPath($BuildPath)
    $resolvedRepo = [System.IO.Path]::GetFullPath($RepoRoot.Path)
    if (-not $resolvedBuild.StartsWith($resolvedRepo, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to delete build path outside repository: $resolvedBuild"
    }
    if (Test-Path -LiteralPath $BuildPath) {
        Remove-Item -LiteralPath $BuildPath -Recurse -Force
    }
}

Stop-OutputProcesses

Write-Host "Configuring NXGS Gaming with MSYS2"
Invoke-Msys2 "cd '$RepoMsys' && cmake -S . -B '$BuildDir' -G Ninja -DCMAKE_BUILD_TYPE=Release -DCHIAKI_ENABLE_CLI=OFF"

Write-Host "Building NXGS Gaming incrementally"
Invoke-Msys2 "cd '$RepoMsys' && cmake --build '$BuildDir' --config Release --target chiaki"

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$resolvedRepoRoot = [System.IO.Path]::GetFullPath($RepoRoot.Path)
if (-not $resolvedOutput.StartsWith($resolvedRepoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to write output outside repository: $resolvedOutput"
}
if (Test-Path -LiteralPath $OutputPath) {
    Remove-Item -LiteralPath $OutputPath -Recurse -Force
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputPath) | Out-Null

Write-Host "Deploying portable folder"
$OutputMsys = ConvertTo-MsysPath $OutputPath
Invoke-Msys2 "cd '$RepoMsys' && APP_EXE_NAME='NXGS Gaming.exe' scripts/deploy-windows-msys2.sh '$OutputMsys' '$BuildDir/gui/chiaki.exe' '$BuildDir/third-party/cpp-steam-tools' /mingw64 gui/src/qml"

$versionMajor = (Select-String -Path (Join-Path $RepoRoot "CMakeLists.txt") -Pattern 'set\(CHIAKI_VERSION_MAJOR ([0-9]+)\)').Matches.Groups[1].Value
$versionMinor = (Select-String -Path (Join-Path $RepoRoot "CMakeLists.txt") -Pattern 'set\(CHIAKI_VERSION_MINOR ([0-9]+)\)').Matches.Groups[1].Value
$versionPatch = (Select-String -Path (Join-Path $RepoRoot "CMakeLists.txt") -Pattern 'set\(CHIAKI_VERSION_PATCH ([0-9]+)\)').Matches.Groups[1].Value
$version = "$versionMajor.$versionMinor.$versionPatch"
$commit = (git -C $RepoRoot rev-parse HEAD 2>$null)
$branch = (git -C $RepoRoot rev-parse --abbrev-ref HEAD 2>$null)
$shortCommit = if ($commit) { $commit.Substring(0, [Math]::Min(8, $commit.Length)) } else { "local" }
$trackedStatus = (git -C $RepoRoot status --porcelain --untracked-files=no 2>$null)
$dirtySuffix = if ($trackedStatus) { ".dirty" } else { "" }
$versionCode = "$version+local.$shortCommit$dirtySuffix"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "write-build-info.ps1") `
    -OutputDir $OutputPath `
    -Version $version `
    -VersionCode $versionCode `
    -Commit $commit `
    -Branch $branch

Write-Host "Created local portable app: $AppExe"

if ($Launch) {
    Write-Host "Launching $AppExe"
    Start-Process -FilePath $AppExe -WorkingDirectory $OutputPath
}
