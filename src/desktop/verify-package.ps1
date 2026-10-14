<# Verify the package manifest against all shipped files; report extra/missing/changed files. #>
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$PackageDir, [switch]$RequireRelease)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$PackageDir = [IO.Path]::GetFullPath($PackageDir)
$manifest = Get-Content -LiteralPath (Join-Path $PackageDir 'release-manifest.json') -Raw | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1) { throw 'Unsupported release manifest version.' }
if ($RequireRelease -and -not $manifest.releaseVerified) { throw 'Package is a development/unverified build.' }
$prefix = $PackageDir.TrimEnd('\') + '\'
$expected = @{}
foreach ($entry in $manifest.files) {
    $fullPath = [IO.Path]::GetFullPath((Join-Path $PackageDir $entry.path))
    if (-not $fullPath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Manifest path escapes package.' }
    if ($expected.ContainsKey($entry.path)) { throw "Duplicate manifest entry: $($entry.path)" }
    $expected[$entry.path] = $true
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { throw "Missing package file: $($entry.path)" }
    if ((Get-Item -LiteralPath $fullPath).Length -ne $entry.bytes -or
        (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) {
        throw "Package file changed: $($entry.path)"
    }
}
foreach ($file in Get-ChildItem -LiteralPath $PackageDir -Recurse -File) {
    $relative = $file.FullName.Substring($prefix.Length).Replace('\', '/')
    if ($relative -ne 'release-manifest.json' -and -not $expected.ContainsKey($relative)) { throw "Unlisted package file: $relative" }
}
Write-Host "PASS: $($expected.Count) package files verified; releaseVerified=$($manifest.releaseVerified)"
