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

$json = $manifest | ConvertTo-Json -Depth 4
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($outputPath, $json, $utf8NoBom)
Write-Host "Wrote update manifest to $outputPath"
