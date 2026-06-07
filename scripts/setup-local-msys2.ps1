param(
    [string]$MsysRoot = "C:\msys64",
    [string]$LibplaceboVersion = "v7.360.1",
    [string]$LocalDepsDir = "build-local-msys2\_deps"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$MsysRoot = [System.IO.Path]::GetFullPath($MsysRoot)
$Bash = Join-Path $MsysRoot "usr\bin\bash.exe"

if (-not (Test-Path -LiteralPath $Bash)) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "MSYS2 is not installed and winget is not available. Install MSYS2, then rerun this script."
    }
    Write-Host "Installing MSYS2 to $MsysRoot"
    winget install --id MSYS2.MSYS2 --exact --accept-source-agreements --accept-package-agreements --location $MsysRoot
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

$RepoMsys = (& $Bash -lc "cygpath -u '$($RepoRoot.Path -replace '\\', '\\')'").Trim()
if ($LASTEXITCODE -ne 0 -or -not $RepoMsys) {
    throw "Failed to convert repo path for MSYS2"
}
$LocalDepsPath = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $LocalDepsDir))
$ResolvedRepoRoot = [System.IO.Path]::GetFullPath($RepoRoot.Path)
if (-not $LocalDepsPath.StartsWith($ResolvedRepoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to use dependency cache outside repository: $LocalDepsPath"
}
$LocalDepsMsys = (& $Bash -lc "cygpath -u '$($LocalDepsPath -replace '\\', '\\')'").Trim()
if ($LASTEXITCODE -ne 0 -or -not $LocalDepsMsys) {
    throw "Failed to convert local dependency cache path for MSYS2"
}
$LocalDepsRepoArg = $LocalDepsDir.Replace("\", "/")

Write-Host "Updating MSYS2 package database"
& $Bash -lc "export MSYSTEM=MINGW64; export CHERE_INVOKING=1; source /etc/profile; pacman --noconfirm -Syuu || true"
if ($LASTEXITCODE -ne 0) {
    Write-Warning "MSYS2 first update exited with code $LASTEXITCODE, usually because the runtime restarted. Continuing."
}
Invoke-Msys2 "pacman --noconfirm -Syy"

$Packages = @(
    "mingw-w64-x86_64-ca-certificates",
    "mingw-w64-x86_64-cmake",
    "mingw-w64-x86_64-curl",
    "mingw-w64-x86_64-diffutils",
    "mingw-w64-x86_64-fast_float",
    "mingw-w64-x86_64-fftw",
    "mingw-w64-x86_64-gcc",
    "mingw-w64-x86_64-hidapi",
    "mingw-w64-x86_64-json-c",
    "mingw-w64-x86_64-lcms2",
    "mingw-w64-x86_64-libdovi",
    "mingw-w64-x86_64-libevent",
    "mingw-w64-x86_64-meson",
    "mingw-w64-x86_64-miniupnpc",
    "mingw-w64-x86_64-nasm",
    "mingw-w64-x86_64-ninja",
    "mingw-w64-x86_64-openssl",
    "mingw-w64-x86_64-opus",
    "mingw-w64-x86_64-pkgconf",
    "mingw-w64-x86_64-protobuf",
    "mingw-w64-x86_64-python",
    "mingw-w64-x86_64-python-glad",
    "mingw-w64-x86_64-python-jinja",
    "mingw-w64-x86_64-python-pip",
    "mingw-w64-x86_64-python-psutil",
    "mingw-w64-x86_64-qt6-base",
    "mingw-w64-x86_64-qt6-declarative",
    "mingw-w64-x86_64-qt6-positioning",
    "mingw-w64-x86_64-qt6-serialport",
    "mingw-w64-x86_64-qt6-svg",
    "mingw-w64-x86_64-qt6-webchannel",
    "mingw-w64-x86_64-qt6-websockets",
    "mingw-w64-x86_64-shaderc",
    "mingw-w64-x86_64-speexdsp",
    "mingw-w64-x86_64-spirv-cross",
    "mingw-w64-x86_64-vulkan",
    "mingw-w64-x86_64-vulkan-headers",
    "git",
    "make",
    "unzip",
    "zip"
)

Write-Host "Installing MSYS2 build dependencies"
Invoke-Msys2 "pacman --noconfirm --needed -S $($Packages -join ' ')"

Write-Host "Installing Python protobuf module"
Invoke-Msys2 "python -m pip install --break-system-packages --upgrade protobuf"

Write-Host "Installing FFmpeg shared build into /mingw64 if needed"
Invoke-Msys2 @"
set -e
mkdir -p '$LocalDepsMsys'
cd '$LocalDepsMsys'
if ! ls /mingw64/bin/avcodec-*.dll >/dev/null 2>&1; then
  curl -L -o ffmpeg-n7.1-latest-win64-gpl-shared-7.1.zip https://github.com/streetpea/FFmpeg-Builds/releases/download/latest/ffmpeg-n7.1-latest-win64-gpl-shared-7.1.zip
  rm -rf ffmpeg-n7.1-latest-win64-gpl-shared-7.1
  unzip -q ffmpeg-n7.1-latest-win64-gpl-shared-7.1.zip
  cp -a ffmpeg-n7.1-latest-win64-gpl-shared-7.1/bin/. /mingw64/bin
  cp -a ffmpeg-n7.1-latest-win64-gpl-shared-7.1/include/. /mingw64/include
  cp -a ffmpeg-n7.1-latest-win64-gpl-shared-7.1/lib/. /mingw64/lib
fi
"@

Write-Host "Building/installing libplacebo if needed"
Invoke-Msys2 @"
set -e
mkdir -p '$LocalDepsMsys'
cd '$RepoMsys'
if ! pkg-config --exists libplacebo; then
  LIBPLACEBO_VERSION='$LibplaceboVersion' scripts/build-libplacebo-windows.sh '$LocalDepsRepoArg'
fi
"@

Write-Host "Building/installing SDL2 compatibility layer if needed"
Invoke-Msys2 @"
set -e
mkdir -p '$LocalDepsMsys'
cd '$RepoMsys'
if ! pkg-config --exists sdl2-compat; then
  INSTALL_PREFIX=/mingw64 scripts/build-sdl2-compat.sh '$LocalDepsRepoArg'
  cp /mingw64/lib/pkgconfig/sdl2-compat.pc /mingw64/lib/pkgconfig/sdl2.pc
fi
"@

Write-Host "Local MSYS2 build environment is ready: $MsysRoot"
