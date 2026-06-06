param(
    [string]$BuildDir = "build",
    [string]$OutputDir = "NXGS-Gaming-Win",
    [string]$Configuration = "Release",
    [string[]]$DependencyDirs = @(),
    [switch]$SkipBuild,
    [switch]$Zip
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$BuildPath = Join-Path $RepoRoot $BuildDir
$OutputPath = Join-Path $RepoRoot $OutputDir
$AppExeName = "NXGS Gaming.exe"

function Assert-UnderRepo {
    param([string]$Path)
    $resolved = [System.IO.Path]::GetFullPath($Path)
    $repo = [System.IO.Path]::GetFullPath($RepoRoot)
    if (-not $resolved.StartsWith($repo, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to write outside repository: $resolved"
    }
}

Assert-UnderRepo $OutputPath

if (-not $SkipBuild) {
    if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
        throw "cmake was not found in PATH. Install CMake, Qt 6, Ninja/MSVC, and the project dependencies first."
    }

    if (-not (Test-Path (Join-Path $BuildPath "CMakeCache.txt"))) {
        cmake -S $RepoRoot -B $BuildPath -G Ninja `
            -DCMAKE_BUILD_TYPE=$Configuration `
            -DCHIAKI_ENABLE_CLI=OFF `
            -DCHIAKI_GUI_ENABLE_SDL_GAMECONTROLLER=ON `
            -DCHIAKI_ENABLE_STEAMDECK_NATIVE=OFF
    }

    cmake --build $BuildPath --config $Configuration --target chiaki
}

$candidateExes = @(
    (Join-Path $BuildPath "gui\chiaki.exe"),
    (Join-Path $BuildPath "gui\$Configuration\chiaki.exe")
)

$sourceExe = $candidateExes | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $sourceExe) {
    throw "Could not find built GUI executable. Expected one of: $($candidateExes -join ', ')"
}

if (Test-Path $OutputPath) {
    Remove-Item -LiteralPath $OutputPath -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $OutputPath | Out-Null

Copy-Item -LiteralPath $sourceExe -Destination (Join-Path $OutputPath $AppExeName)

$steamTools = Join-Path $BuildPath "third-party\cpp-steam-tools\cpp-steam-tools.dll"
if (Test-Path $steamTools) {
    Copy-Item -LiteralPath $steamTools -Destination $OutputPath
}

$defaultDependencyDirs = @(
    (Join-Path $RepoRoot "deps\bin"),
    (Join-Path $BuildPath "vcpkg_installed\x64-windows\bin"),
    (Join-Path $RepoRoot "vcpkg_installed\x64-windows\bin")
)

foreach ($dir in @($defaultDependencyDirs + $DependencyDirs)) {
    if (Test-Path $dir) {
        Get-ChildItem -LiteralPath $dir -Filter "*.dll" -File | Copy-Item -Destination $OutputPath -Force
    }
}

if (Get-Command windeployqt.exe -ErrorAction SilentlyContinue) {
    windeployqt.exe --no-translations --qmldir=(Join-Path $RepoRoot "gui\src\qml") --release (Join-Path $OutputPath $AppExeName)
} else {
    Write-Warning "windeployqt.exe was not found in PATH. Qt runtime files were not deployed."
}

Copy-Item -LiteralPath (Join-Path $RepoRoot "COPYING") -Destination $OutputPath -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot "README.md") -Destination $OutputPath -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot "LICENSES") -Destination (Join-Path $OutputPath "LICENSES") -Recurse -Force

$versionMajor = (Select-String -Path (Join-Path $RepoRoot "CMakeLists.txt") -Pattern 'set\(CHIAKI_VERSION_MAJOR ([0-9]+)\)').Matches.Groups[1].Value
$versionMinor = (Select-String -Path (Join-Path $RepoRoot "CMakeLists.txt") -Pattern 'set\(CHIAKI_VERSION_MINOR ([0-9]+)\)').Matches.Groups[1].Value
$versionPatch = (Select-String -Path (Join-Path $RepoRoot "CMakeLists.txt") -Pattern 'set\(CHIAKI_VERSION_PATCH ([0-9]+)\)').Matches.Groups[1].Value
$version = "$versionMajor.$versionMinor.$versionPatch"
$commit = ""
$branch = ""
if (Get-Command git -ErrorAction SilentlyContinue) {
    $commit = (git -C $RepoRoot rev-parse HEAD 2>$null)
    $branch = (git -C $RepoRoot rev-parse --abbrev-ref HEAD 2>$null)
}
$shortCommit = if ($commit) { $commit.Substring(0, [Math]::Min(8, $commit.Length)) } else { "local" }
$versionCode = "$version+local.$shortCommit"

@"
NXGS Gaming source code availability

The complete corresponding source code for NXGS Gaming is available at:
https://github.com/sowankispassah/nxgs_gaming

NXGS Gaming is a fork of chiaki-ng, which is based on Chiaki. This fork is
distributed under the GNU Affero General Public License v3.0.

NXGS Gaming is not affiliated with, endorsed by, sponsored by, or certified by
Sony Interactive Entertainment LLC, PlayStation, chiaki-ng, Chiaki, or the
original maintainers.
"@ | Set-Content -LiteralPath (Join-Path $OutputPath "SOURCE_CODE.txt") -Encoding UTF8

powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "write-build-info.ps1") `
    -OutputDir $OutputPath `
    -Version $version `
    -VersionCode $versionCode `
    -Commit $commit `
    -Branch $branch

if ($Zip) {
    $zipPath = Join-Path $RepoRoot "nxgs-gaming-win_x64-portable-$version-$shortCommit.zip"
    if (Test-Path $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }
    Compress-Archive -LiteralPath $OutputPath -DestinationPath $zipPath
    Write-Host "Created portable zip: $zipPath"
}

Write-Host "Created portable app folder: $OutputPath"
Write-Host "Open: $(Join-Path $OutputPath $AppExeName)"
