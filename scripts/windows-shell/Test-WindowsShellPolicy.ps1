[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$source = Join-Path $root 'src\windows-shell'
$output = Join-Path $root ('work\windows-shell-tests\' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $output -Force | Out-Null
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:exe /platform:x64 "/out:$output\ShellPolicyTests.exe" /reference:System.dll /reference:System.Core.dll /reference:System.Web.Extensions.dll (Join-Path $source 'ShellPolicy.cs') (Join-Path $source 'tests\ShellPolicyTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Windows shell policy test compilation failed.' }
& (Join-Path $output 'ShellPolicyTests.exe')
if ($LASTEXITCODE -ne 0) { throw 'Windows shell policy tests failed.' }
