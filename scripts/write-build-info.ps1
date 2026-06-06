param(
    [Parameter(Mandatory = $true)]
    [string]$OutputDir,

    [Parameter(Mandatory = $true)]
    [string]$Version,

    [Parameter(Mandatory = $true)]
    [string]$VersionCode,

    [string]$Commit = "",
    [string]$Branch = "",
    [string]$RunUrl = "",
    [string]$SourceUrl = "https://github.com/sowankispassah/nxgs_gaming",
    [string]$BuiltAtUtc = ""
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $OutputDir)) {
    throw "Output directory does not exist: $OutputDir"
}

if (-not $BuiltAtUtc) {
    $BuiltAtUtc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
}

$lines = @(
    "App: NXGS Gaming",
    "Version: $Version",
    "Version code: $VersionCode",
    "Commit: $Commit",
    "Branch: $Branch",
    "Built UTC: $BuiltAtUtc",
    "Source: $SourceUrl"
)

if ($RunUrl) {
    $lines += "Workflow run: $RunUrl"
}

$lines += @(
    "",
    "NXGS Gaming is a fork of chiaki-ng, which is based on Chiaki.",
    "NXGS Gaming is distributed under the GNU Affero General Public License v3.0.",
    "NXGS Gaming is not affiliated with, endorsed by, sponsored by, or certified by Sony Interactive Entertainment LLC, PlayStation, chiaki-ng, Chiaki, or the original maintainers."
)

$buildInfoPath = Join-Path $OutputDir "BUILD_INFO.txt"
$lines | Set-Content -LiteralPath $buildInfoPath -Encoding UTF8
Write-Host "Wrote build info: $buildInfoPath"
