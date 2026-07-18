param()

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$source = Join-Path $projectRoot "native\controller-idle-helper\Program.cs"
$outputDirectory = Join-Path $projectRoot "vendor\controller-idle-helper"
$output = Join-Path $outputDirectory "NxgsControllerIdleHelper.exe"

if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "Controller idle helper source was not found: $source"
}

New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
if (Test-Path -LiteralPath $output) {
    Remove-Item -LiteralPath $output -Force
}

Add-Type `
    -Path $source `
    -ReferencedAssemblies @("System.dll", "System.Core.dll", "System.Windows.Forms.dll") `
    -OutputAssembly $output `
    -OutputType ConsoleApplication `
    -ErrorAction Stop

$selfTest = & $output --self-test
if ($LASTEXITCODE -ne 0 -or $selfTest -ne "SELF_TEST|OK") {
    throw "Controller idle helper self-test failed: $selfTest"
}

Get-Item -LiteralPath $output | Select-Object FullName, Length, LastWriteTime
