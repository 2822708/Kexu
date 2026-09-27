<# Run the actual desktop shell against a fresh, explicit directory. No user data is read. #>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PackageDir,
    [string]$TestRoot
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not $TestRoot) { $TestRoot = Join-Path $projectRoot ('work\desktop-smoke\' + [guid]::NewGuid().ToString('N')) }
$TestRoot = [IO.Path]::GetFullPath($TestRoot)
$workPrefix = [IO.Path]::GetFullPath((Join-Path $projectRoot 'work')).TrimEnd('\') + '\'
if (-not $TestRoot.StartsWith($workPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Smoke data must be under this repository work directory.' }
if (Test-Path -LiteralPath $TestRoot) { throw 'Smoke data directory must be new; existing data is never reused.' }
$PackageDir = [IO.Path]::GetFullPath($PackageDir)
$shellExe = Join-Path $PackageDir 'TangentTimetable.exe'
if (-not (Test-Path -LiteralPath $shellExe)) { throw 'Desktop executable missing.' }
if (Get-NetTCPConnection -LocalPort 17817 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Port 17817 is already occupied; no existing service will be stopped or reused.'
}
New-Item -ItemType Directory -Path $TestRoot -Force | Out-Null
$resultPath = Join-Path $TestRoot 'desktop-smoke-result.txt'
$shellProcess = $null
$backendProcessId = $null
try {
    $shellProcess = Start-Process -FilePath $shellExe -ArgumentList @('--smoke-test', ('--data-dir="' + $TestRoot + '"')) -WorkingDirectory $PackageDir -WindowStyle Hidden -PassThru
    if (-not $shellProcess.WaitForExit(120000)) { throw 'Desktop smoke test timed out after 120 seconds.' }
    if ($shellProcess.ExitCode -ne 0) { throw "Desktop shell failed (exit $($shellProcess.ExitCode)); see $resultPath" }
    if (-not (Test-Path -LiteralPath $resultPath)) { throw 'Desktop shell did not produce a smoke result.' }
    $result = Get-Content -LiteralPath $resultPath -Raw
    if ($result -notmatch '^PASS:') { throw "Desktop smoke failed: $result" }
    if ($result -notmatch '(?m)^Backend PID: (\d+)') { throw 'Smoke result omitted backend PID.' }
    $backendProcessId = [int]$Matches[1]
    if (Get-Process -Id $backendProcessId -ErrorAction SilentlyContinue) { throw "Owned backend PID $backendProcessId remained after shell shutdown." }
    if (-not (Test-Path -LiteralPath (Join-Path $TestRoot 'desktop-key.dpapi'))) { throw 'Protected desktop credential missing.' }
    if (Test-Path -LiteralPath (Join-Path $TestRoot 'desktop-key.txt')) { throw 'Plaintext desktop credential created.' }
    Write-Host $result.Trim()
    Write-Host "PASS: owned backend cleaned up; isolated data at $TestRoot"
} finally {
    if ($shellProcess -and -not $shellProcess.HasExited) {
        # Killing only this test shell lets its Job Object terminate only its own Java child.
        Stop-Process -Id $shellProcess.Id -Force
        $shellProcess.WaitForExit(5000) | Out-Null
    }
    if ($shellProcess) { $shellProcess.Dispose() }
}
