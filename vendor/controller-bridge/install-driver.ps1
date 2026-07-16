param(
    [Parameter(Mandatory = $true)]
    [string]$Installer
)

$ErrorActionPreference = "Stop"
$expectedHash = "89220a7865076b342892f98865f3499fb7c4cfd673159e89d352c360fd014c6a"
$resolvedInstaller = (Resolve-Path -LiteralPath $Installer).Path
$actualHash = (Get-FileHash -LiteralPath $resolvedInstaller -Algorithm SHA256).Hash.ToLowerInvariant()

if ($actualHash -ne $expectedHash) {
    throw "Controller driver package failed integrity validation."
}

$signature = Get-AuthenticodeSignature -LiteralPath $resolvedInstaller
if ($signature.Status -ne "Valid") {
    throw "Controller driver signature validation failed: $($signature.StatusMessage)"
}

$process = Start-Process `
    -FilePath $resolvedInstaller `
    -ArgumentList "/qn" `
    -Verb RunAs `
    -WindowStyle Hidden `
    -Wait `
    -PassThru

exit $process.ExitCode
