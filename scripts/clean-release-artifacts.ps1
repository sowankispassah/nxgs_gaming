param()

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$releasePath = Join-Path $projectRoot "release"

if (-not (Test-Path -LiteralPath $releasePath)) {
    New-Item -ItemType Directory -Force -Path $releasePath | Out-Null
    Write-Host "Created release directory: $releasePath"
    exit 0
}

$resolvedReleasePath = (Resolve-Path -LiteralPath $releasePath).Path
if (-not $resolvedReleasePath.StartsWith($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clean release artifacts outside the project root: $resolvedReleasePath"
}

$filePatterns = @(
    "NXGS*.exe",
    "NXGS*.exe.blockmap",
    "latest.yml",
    "builder-debug.yml"
)

foreach ($pattern in $filePatterns) {
    Get-ChildItem -LiteralPath $resolvedReleasePath -File -Filter $pattern -ErrorAction SilentlyContinue |
        ForEach-Object {
            Remove-Item -LiteralPath $_.FullName -Force
            Write-Host "Removed generated artifact: $($_.Name)"
        }
}

$unpackedPath = Join-Path $resolvedReleasePath "win-unpacked"
if (Test-Path -LiteralPath $unpackedPath) {
    $resolvedUnpackedPath = (Resolve-Path -LiteralPath $unpackedPath).Path
    if (-not $resolvedUnpackedPath.StartsWith($resolvedReleasePath, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove unpacked build outside release directory: $resolvedUnpackedPath"
    }
    Remove-Item -LiteralPath $resolvedUnpackedPath -Recurse -Force
    Write-Host "Removed generated artifact: win-unpacked"
}
