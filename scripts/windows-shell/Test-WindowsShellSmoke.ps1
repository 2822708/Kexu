<# Launch twice with an explicitly isolated E:/workspace profile. No existing application profile is opened. #>
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$PackageDir, [string]$TestRoot)
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$workPrefix = [IO.Path]::GetFullPath((Join-Path $root 'work')).TrimEnd('\') + '\'
if (-not $TestRoot) { $TestRoot = Join-Path $root ('work\windows-shell-smoke\' + [guid]::NewGuid().ToString('N')) }
$TestRoot = [IO.Path]::GetFullPath($TestRoot)
if (-not $TestRoot.StartsWith($workPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Smoke profile must be under this repository work directory.' }
if (Test-Path -LiteralPath $TestRoot) { throw 'Smoke profile must be new. Existing data is preserved.' }
$exe = Join-Path ([IO.Path]::GetFullPath($PackageDir)) 'Kexu.exe'
New-Item -ItemType Directory -Path $TestRoot -Force | Out-Null
for ($launch = 1; $launch -le 2; $launch++) {
    $process = Start-Process -FilePath $exe -ArgumentList @('--smoke-test', ('--data-dir="' + $TestRoot + '"')) -WorkingDirectory $PackageDir -WindowStyle Hidden -PassThru
    try {
        if (-not $process.WaitForExit(60000)) { Stop-Process -Id $process.Id -Force; throw 'Windows shell smoke exceeded 60 seconds.' }
        $resultPath = Join-Path $TestRoot 'shell-smoke-result.json'
        if (-not (Test-Path -LiteralPath $resultPath)) { throw "Shell produced no smoke result; exit $($process.ExitCode)." }
        $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
        if ($process.ExitCode -ne 0 -or -not $result.ok) { throw "Shell launch $launch failed: $($result | ConvertTo-Json -Depth 4 -Compress)" }
        if ($launch -eq 2 -and -not $result.persistedAcrossLaunch) { throw 'IndexedDB did not persist across shell launches.' }
        if (-not $result.realDailyTaskSaved -or -not $result.logicalRouteReload) { throw 'Rendered daily task save or logical route reload failed.' }
        if ($launch -eq 2 -and -not $result.realDailyTaskPersistedAcrossLaunch) { throw 'Real daily task did not persist across shell launches.' }
        Write-Host "PASS: shell launch $launch; rendered /focus; secure origin; real daily task + reload; runtime $($result.runtime); persisted=$($result.persistedAcrossLaunch)"
    } finally { $process.Dispose() }
}
Write-Host "Smoke evidence: $(Join-Path $TestRoot 'shell-smoke-result.json')"
