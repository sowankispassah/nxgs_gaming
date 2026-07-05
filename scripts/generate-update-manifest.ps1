param(
    [Parameter(Mandatory = $true)]
    [string]$Installer,

    [Parameter(Mandatory = $true)]
    [string]$DownloadUrl,

    [string]$Output = "updates\windows-update.json",

    [string]$Notes = "NXGS Play update is ready to install.",

    [switch]$Required
)

$ErrorActionPreference = "Stop"

$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$packageJsonPath = Join-Path (Get-Location) "package.json"
$packageJson = Get-Content -Raw -LiteralPath $packageJsonPath | ConvertFrom-Json
$hash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()
$outputPath = Join-Path (Get-Location) $Output
$outputDirectory = Split-Path -Parent $outputPath

if ($outputDirectory) {
    New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
}

$manifest = [ordered]@{
    version = $packageJson.version
    downloadUrl = $DownloadUrl
    sha256 = $hash
    required = [bool]$Required
    notes = $Notes
}

$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $outputPath -Encoding UTF8
Write-Host "Wrote update manifest to $outputPath"
