<# Compile and run the native trust/DPAPI regression suite against isolated synthetic data. #>
[CmdletBinding()]
param([string]$OutputDir)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not $OutputDir) { $OutputDir = Join-Path $projectRoot ('work\desktop-security\' + [guid]::NewGuid().ToString('N')) }
$OutputDir = [IO.Path]::GetFullPath($OutputDir)
$workPrefix = [IO.Path]::GetFullPath((Join-Path $projectRoot 'work')).TrimEnd('\') + '\'
if (-not $OutputDir.StartsWith($workPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Security test output must be inside repository work.' }
if (Test-Path -LiteralPath $OutputDir) { throw 'Use a new test output directory.' }
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$executable = Join-Path $OutputDir 'DesktopSecurityTests.exe'
& $csc /nologo /target:exe /platform:x64 /reference:System.Security.dll "/out:$executable" (Join-Path $PSScriptRoot 'shell\DesktopSecurity.cs') (Join-Path $PSScriptRoot 'tests\DesktopSecurityTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Security test compilation failed.' }
$data = Join-Path $OutputDir 'data'
& $executable $data
if ($LASTEXITCODE -ne 0) { throw 'Native desktop security regression failed.' }
& node.exe (Join-Path $PSScriptRoot 'tests\login-script.test.cjs') $data
if ($LASTEXITCODE -ne 0) { throw 'Desktop login script regression failed.' }
