<# Package the latest local-data frontend as a Windows x64 WebView2 app, preserving any existing output/data. #>
[CmdletBinding()]
param(
    [string]$FrontendDist,
    [Parameter(Mandatory = $true)][string]$OutputDir,
    [Parameter(Mandatory = $true)][string]$SdkPackage,
    [string]$FixedWebView2RuntimeDir
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$source = Join-Path $root 'src\windows-shell'
if (-not $FrontendDist) { $FrontendDist = Join-Path $root 'src\frontend\dist-shell' }
$FrontendDist = [IO.Path]::GetFullPath($FrontendDist)
$OutputDir = [IO.Path]::GetFullPath($OutputDir)
$destination = Join-Path $OutputDir 'Kexu-Windows-x64'
if (Test-Path -LiteralPath $destination) { throw "Existing package preserved: $destination" }
if (-not (Test-Path -LiteralPath (Join-Path $FrontendDist 'index.html'))) { throw 'Build the local-data frontend with npm run build:shell first.' }
if (Test-Path -LiteralPath (Join-Path $FrontendDist 'sw.js')) { throw 'Native shell bundle must not include a service worker.' }
$html = Get-Content -LiteralPath (Join-Path $FrontendDist 'index.html') -Raw
if ($html -match 'rel=["'']manifest["'']|registerSW|register-sw') { throw 'Native shell bundle must not register a web manifest/service worker.' }
$lock = Get-Content -LiteralPath (Join-Path $source 'toolchain.json') -Raw | ConvertFrom-Json
$sdkHash = (Get-FileHash -LiteralPath $SdkPackage -Algorithm SHA256).Hash.ToLowerInvariant()
if ($sdkHash -ne $lock.webView2Sdk.sha256) { throw 'Pinned WebView2 SDK SHA256 mismatch.' }
$netRelease = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full').Release
if ($netRelease -lt $lock.minimumDotNetRelease) { throw '.NET Framework 4.8 or later is required.' }
$buildRoot = Join-Path $root ('work\windows-shell-build\' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
$staging = Join-Path $buildRoot 'Kexu-Windows-x64'
$sdk = Join-Path $buildRoot 'sdk'
New-Item -ItemType Directory -Path $staging -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory([IO.Path]::GetFullPath($SdkPackage), $sdk)
foreach ($name in @('Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll')) {
    Copy-Item -LiteralPath (Join-Path $sdk "lib\net462\$name") -Destination (Join-Path $staging $name)
}
Copy-Item -LiteralPath (Join-Path $sdk 'runtimes\win-x64\native\WebView2Loader.dll') -Destination $staging
Copy-Item -LiteralPath $FrontendDist -Destination (Join-Path $staging 'app') -Recurse
Copy-Item -LiteralPath (Join-Path $source 'Kexu.exe.config') -Destination $staging
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$compilerArgs = @('/nologo','/target:winexe','/platform:x64','/optimize+',"/out:$staging\Kexu.exe",
    '/reference:System.dll','/reference:System.Core.dll','/reference:System.Drawing.dll','/reference:System.Windows.Forms.dll','/reference:System.Web.Extensions.dll',
    "/reference:$staging\Microsoft.Web.WebView2.Core.dll", "/reference:$staging\Microsoft.Web.WebView2.WinForms.dll",
    "/win32icon:$source\app.ico", "/win32manifest:$source\app.manifest", (Join-Path $source 'Program.cs'), (Join-Path $source 'ShellPolicy.cs'))
& $compiler @compilerArgs
if ($LASTEXITCODE -ne 0) { throw 'Windows shell compilation failed.' }
$runtimeMode = 'installed-evergreen-required'
$runtimeVersion = $null
if ($FixedWebView2RuntimeDir) {
    $runtimeExe = Join-Path $FixedWebView2RuntimeDir 'msedgewebview2.exe'
    if (-not (Test-Path -LiteralPath $runtimeExe)) { throw 'Expanded Fixed Version Runtime must contain msedgewebview2.exe.' }
    $signature = Get-AuthenticodeSignature -LiteralPath $runtimeExe
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'Fixed runtime requires a valid Microsoft signature.' }
    if (Get-ChildItem -LiteralPath $FixedWebView2RuntimeDir -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'Fixed runtime must not contain reparse points.' }
    Copy-Item -LiteralPath $FixedWebView2RuntimeDir -Destination (Join-Path $staging 'webview2-runtime') -Recurse
    $runtimeMode = 'bundled-fixed'; $runtimeVersion = (Get-Item -LiteralPath $runtimeExe).VersionInfo.ProductVersion
}
Copy-Item -LiteralPath (Join-Path $source 'README.md') -Destination (Join-Path $staging 'README.md')
Copy-Item -LiteralPath (Join-Path $root 'LICENSE') -Destination $staging
Copy-Item -LiteralPath (Join-Path $sdk 'LICENSE.txt') -Destination (Join-Path $staging 'WebView2-SDK-LICENSE.txt')
& (Join-Path $PSScriptRoot 'Test-WindowsShellPolicy.ps1')
$prefix = [IO.Path]::GetFullPath($staging).TrimEnd('\') + '\'
$inventory = @(Get-ChildItem -LiteralPath $staging -Recurse -File | Sort-Object FullName | ForEach-Object {
    [ordered]@{ path = $_.FullName.Substring($prefix.Length).Replace('\','/'); bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
})
$manifest = [ordered]@{
    schemaVersion = 1; product = '课序本地PWA Windows'; builtAtUtc = [DateTime]::UtcNow.ToString('o')
    gitHead = (& git -C $root rev-parse HEAD).Trim(); workingTreeDirty = [bool](& git -C $root status --porcelain)
    origin = $lock.origin; data = 'app-directory/Data, or explicit --data-dir / kexu-data-dir.txt; never bundled'
    sdk = $lock.webView2Sdk; runtime = @{ mode = $runtimeMode; version = $runtimeVersion }
    frontendSha256 = (Get-FileHash -LiteralPath (Join-Path $FrontendDist 'index.html') -Algorithm SHA256).Hash.ToLowerInvariant()
    requiresJava = $false; requiresNode = $false; runtimeSmoke = 'not-run-by-build'; files = $inventory
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $staging 'package-manifest.json') -Encoding UTF8
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
Move-Item -LiteralPath $staging -Destination $destination
$zip = Join-Path $OutputDir 'Kexu-Windows-x64.zip'
if (Test-Path -LiteralPath $zip) { throw "Existing zip preserved: $zip" }
[IO.Compression.ZipFile]::CreateFromDirectory($destination, $zip, [IO.Compression.CompressionLevel]::Optimal, $true)
$zipHash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
"$zipHash  Kexu-Windows-x64.zip" | Set-Content -LiteralPath (Join-Path $OutputDir 'SHA256SUMS-windows.txt') -Encoding ascii
Write-Host "Windows EXE: $(Join-Path $destination 'Kexu.exe')"
Write-Host "Portable package: $zip"
Write-Host "SHA256: $zipHash"
Write-Host "Runtime mode: $runtimeMode"
