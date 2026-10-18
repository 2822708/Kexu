<#
.SYNOPSIS
Build the Windows x64 desktop application from locked inputs.
.DESCRIPTION
Uses npm ci, Maven verify, a SHA256-verified pinned WebView2 SDK and locked
Java/Node/npm/C# compiler versions. Release builds require a Fixed Version
WebView2 Runtime directory of the version in toolchain.json. The explicit
-AllowEvergreenRuntime switch builds a development package instead.
Builds into a fresh repository work directory, runs an isolated smoke test,
and publishes only after all gates pass. Never opens real user data or
recursively deletes an existing output folder.
.PARAMETER OutputDir
Parent of the new TangentTimetable output folder; an existing package is preserved.
.PARAMETER SdkPackage
Optional existing .nupkg; its SHA256 must match toolchain.json.
.PARAMETER SkipWebView2Download
Use only the verified repository SDK cache; fail when it is missing.
.PARAMETER FixedWebView2RuntimeDir
Expanded official Windows x64 Fixed Version Runtime containing msedgewebview2.exe.
.PARAMETER AllowEvergreenRuntime
Development-only: use the installed Evergreen Runtime and label the manifest accordingly.
.PARAMETER SkipSmokeTest
Create an explicitly unverified development package, never a release-verified manifest.
#>
[CmdletBinding()]
param(
    [string]$OutputDir,
    [string]$SdkPackage,
    [switch]$SkipWebView2Download,
    [string]$FixedWebView2RuntimeDir,
    [switch]$AllowEvergreenRuntime,
    [switch]$SkipSmokeTest
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$desktopDir = $PSScriptRoot
$sourceRoot = Split-Path $desktopDir -Parent
$projectRoot = Split-Path $sourceRoot -Parent
$backendDir = Join-Path $sourceRoot 'backend'
$frontendDir = Join-Path $sourceRoot 'frontend'
$shellDir = Join-Path $desktopDir 'shell'
$lockPath = Join-Path $desktopDir 'toolchain.json'
$lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
$buildId = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$workRoot = Join-Path $projectRoot 'work\desktop-build'
$buildRoot = Join-Path $workRoot $buildId
$staging = Join-Path $buildRoot 'TangentTimetable'
if (-not $OutputDir) { $OutputDir = Join-Path $desktopDir 'app-image' }
$outputRoot = [IO.Path]::GetFullPath($OutputDir)
$destination = [IO.Path]::GetFullPath((Join-Path $outputRoot 'TangentTimetable'))

function Assert-ChildPath([string]$Path, [string]$Parent) {
    $absolute = [IO.Path]::GetFullPath($Path)
    $prefix = [IO.Path]::GetFullPath($Parent).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    if (-not $absolute.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path escapes the intended directory: $absolute"
    }
    $cursor = $absolute
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "Reparse points are not supported in build paths: $cursor"
            }
        }
        $next = Split-Path $cursor -Parent
        if ($next -eq $cursor) { break }
        $cursor = $next
    }
}
function Assert-Exit([string]$Name) {
    if ($LASTEXITCODE -ne 0) { throw "$Name failed (exit $LASTEXITCODE)." }
}
function Hash-File([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function File-Inventory([string]$Root) {
    $prefix = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    @(Get-ChildItem -LiteralPath $Root -Recurse -File | Sort-Object FullName | ForEach-Object {
        [ordered]@{ path = $_.FullName.Substring($prefix.Length).Replace('\', '/'); bytes = $_.Length; sha256 = Hash-File $_.FullName }
    })
}

Assert-ChildPath $destination $outputRoot
Assert-ChildPath $buildRoot $workRoot
if (Test-Path -LiteralPath $destination) { throw "Existing package preserved: $destination. Choose a new -OutputDir." }
if ($FixedWebView2RuntimeDir -and $AllowEvergreenRuntime) { throw 'Choose either fixed or Evergreen runtime mode.' }
if (-not $FixedWebView2RuntimeDir -and -not $AllowEvergreenRuntime) {
    throw 'Release builds require -FixedWebView2RuntimeDir. Use -AllowEvergreenRuntime only for a development build.'
}

Write-Host 'Checking locked toolchain...'
$javaExe = (Get-Command java.exe -ErrorAction Stop).Source
$jdkDir = Split-Path (Split-Path $javaExe -Parent) -Parent
$jlink = Join-Path $jdkDir 'bin\jlink.exe'
if (-not (Test-Path -LiteralPath $jlink)) { throw "Full JDK with jlink required: $jdkDir" }
$javaSettings = Get-Content -LiteralPath (Join-Path $jdkDir 'release') -Raw
if ($javaSettings -notmatch ('(?m)^JAVA_VERSION="' + [regex]::Escape($lock.javaVersion) + '"\s*$') -or
    $javaSettings -notmatch ('(?m)^IMPLEMENTOR="' + [regex]::Escape($lock.javaVendor) + '"\s*$')) {
    throw "Java must match locked vendor/version: $($lock.javaVendor) $($lock.javaVersion)"
}
$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$npmExe = (Get-Command npm.cmd -ErrorAction Stop).Source
$nodeVersion = (& $nodeExe --version).TrimStart('v')
$npmVersion = (& $npmExe --version).Trim()
if ($nodeVersion -ne $lock.nodeVersion -or $npmVersion -ne $lock.npmVersion) {
    throw "Node/npm must match toolchain.json ($($lock.nodeVersion)/$($lock.npmVersion))"
}
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $csc)) { throw 'Windows x64 .NET Framework compiler missing.' }
$cscVersion = (Get-Item -LiteralPath $csc).VersionInfo.ProductVersion
if ($cscVersion -ne $lock.cscVersion) { throw "C# compiler $cscVersion differs from locked $($lock.cscVersion)" }
$netRelease = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full').Release
if ($netRelease -lt $lock.dotNetMinimumRelease) { throw '.NET Framework 4.8 or later required.' }
foreach ($required in @('app.manifest', 'app.ico', 'TangentTimetable.exe.config', 'Program.cs', 'DesktopSecurity.cs')) {
    if (-not (Test-Path -LiteralPath (Join-Path $shellDir $required))) { throw "Required shell input missing: $required" }
}
$runtimeMode = 'fixed'
$runtimeVersion = $lock.webView2RuntimeVersion
$runtimeSourceHash = $null
if ($FixedWebView2RuntimeDir) {
    $FixedWebView2RuntimeDir = [IO.Path]::GetFullPath($FixedWebView2RuntimeDir)
    $runtimeExe = Join-Path $FixedWebView2RuntimeDir 'msedgewebview2.exe'
    if (-not (Test-Path -LiteralPath $runtimeExe)) { throw 'Fixed runtime must contain msedgewebview2.exe.' }
    if ((Get-Item -LiteralPath $runtimeExe).VersionInfo.ProductVersion -ne $runtimeVersion) { throw "Fixed runtime must be $runtimeVersion" }
    $signature = Get-AuthenticodeSignature -LiteralPath $runtimeExe
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
        throw 'Fixed Runtime executable must have a valid Microsoft signature.'
    }
    $runtimeSourceHash = Hash-File $runtimeExe
} else {
    $runtimeMode = 'evergreen-development'
    $runtimeVersion = 'detected by isolated smoke test'
}

New-Item -ItemType Directory -Force -Path (Join-Path $staging 'app') | Out-Null
Write-Host 'Installing locked frontend dependencies and checking production build...'
Push-Location $frontendDir
try {
    & $npmExe ci --no-audit --no-fund; Assert-Exit 'npm ci'
    & $npmExe run typecheck; Assert-Exit 'Frontend typecheck'
    & $npmExe run lint; Assert-Exit 'Frontend lint'
    & $npmExe run build; Assert-Exit 'Frontend build'
} finally { Pop-Location }

# 把 dist 同步进后端 static 再打 jar：单机版由 jar 直接托管前端产物，
# 少这一步桌面壳打开 http://127.0.0.1:17817/ 只会看到空白页。
Write-Host 'Syncing frontend dist into backend static resources...'
& $nodeExe (Join-Path $projectRoot 'scripts\sync-frontend-dist.mjs'); Assert-Exit 'Frontend dist sync'

Write-Host 'Verifying and packaging standalone backend...'
Push-Location $backendDir
try {
    & .\mvnw.cmd -B -ntp verify -Pstandalone
    Assert-Exit 'Backend verify'
} finally { Pop-Location }
$jar = Join-Path $backendDir 'target\timetable-backend-1.0.0.jar'
if (-not (Test-Path -LiteralPath $jar)) { throw 'Standalone backend JAR missing.' }
Copy-Item -LiteralPath $jar -Destination (Join-Path $staging 'app\timetable-backend.jar')

Write-Host 'Creating trimmed Java runtime...'
$modules = 'java.base,java.compiler,java.desktop,java.instrument,java.management,java.naming,java.net.http,java.prefs,java.rmi,java.scripting,java.security.jgss,java.sql,java.transaction.xa,java.xml,jdk.crypto.ec,jdk.unsupported,jdk.jfr,jdk.zipfs'
& $jlink --add-modules $modules --strip-debug --no-header-files --no-man-pages --compress=zip-6 --output (Join-Path $staging 'runtime')
Assert-Exit 'jlink'

Write-Host 'Verifying pinned WebView2 SDK...'
$sdkCache = Join-Path $projectRoot ('work\desktop-sdk\' + $lock.webView2Sdk.version)
New-Item -ItemType Directory -Force -Path $sdkCache | Out-Null
if (-not $SdkPackage) {
    $SdkPackage = Join-Path $sdkCache 'webview2.nupkg'
    if (-not (Test-Path -LiteralPath $SdkPackage)) {
        if ($SkipWebView2Download) { throw "Verified SDK cache missing: $SdkPackage" }
        Invoke-WebRequest -UseBasicParsing -Uri $lock.webView2Sdk.url -OutFile $SdkPackage
    }
}
if ((Hash-File $SdkPackage) -ne $lock.webView2Sdk.sha256) { throw 'WebView2 SDK SHA256 mismatch. Do not use this package.' }
$sdkExtract = Join-Path $buildRoot 'sdk'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($SdkPackage))
try {
    foreach ($entry in $archive.Entries) { Assert-ChildPath (Join-Path $sdkExtract $entry.FullName) $sdkExtract }
} finally { $archive.Dispose() }
[IO.Compression.ZipFile]::ExtractToDirectory([IO.Path]::GetFullPath($SdkPackage), $sdkExtract)
foreach ($assembly in @('Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll')) {
    Copy-Item -LiteralPath (Join-Path $sdkExtract "lib\net462\$assembly") -Destination $staging
}
Copy-Item -LiteralPath (Join-Path $sdkExtract 'runtimes\win-x64\native\WebView2Loader.dll') -Destination $staging
if ($FixedWebView2RuntimeDir) {
    $runtimeFiles = @(Get-ChildItem -LiteralPath $FixedWebView2RuntimeDir -Recurse -Force)
    if ($runtimeFiles | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'Runtime source contains a reparse point.' }
    Copy-Item -LiteralPath $FixedWebView2RuntimeDir -Destination (Join-Path $staging 'webview2-runtime') -Recurse
}

Write-Host 'Compiling desktop shell...'
$cscArgs = @('/nologo', '/target:winexe', '/platform:x64', '/optimize+',
    "/out:$staging\TangentTimetable.exe", '/reference:System.dll', '/reference:System.Drawing.dll',
    '/reference:System.Windows.Forms.dll', '/reference:System.Core.dll', '/reference:System.Security.dll',
    "/reference:$staging\Microsoft.Web.WebView2.Core.dll", "/reference:$staging\Microsoft.Web.WebView2.WinForms.dll",
    "/win32icon:$shellDir\app.ico", "/win32manifest:$shellDir\app.manifest",
    (Join-Path $shellDir 'Program.cs'), (Join-Path $shellDir 'DesktopSecurity.cs'))
& $csc @cscArgs; Assert-Exit 'Desktop shell compilation'
Copy-Item -LiteralPath (Join-Path $shellDir 'TangentTimetable.exe.config') -Destination $staging
New-Item -ItemType Directory -Path (Join-Path $staging 'tools') | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\desktop\Restore-DesktopBackup.ps1') -Destination (Join-Path $staging 'tools\Restore-DesktopBackup.ps1')
Copy-Item -LiteralPath (Join-Path $desktopDir 'verify-package.ps1') -Destination (Join-Path $staging 'tools\Verify-Package.ps1')
$smokeStatus = 'skipped-unverified'
if (-not $SkipSmokeTest) {
    Write-Host 'Running isolated desktop smoke test...'
    & (Join-Path $desktopDir 'test-desktop-smoke.ps1') -PackageDir $staging -TestRoot (Join-Path $buildRoot 'smoke-data')
    $smokeStatus = 'passed'
    if ($runtimeMode -eq 'evergreen-development') {
        $smokeResult = Get-Content -LiteralPath (Join-Path $buildRoot 'smoke-data\desktop-smoke-result.txt') -Raw
        if ($smokeResult -match '(?m)^WebView2 Runtime: (.+)') { $runtimeVersion = $Matches[1].Trim() }
    }
}

$gitHead = (& git -C $projectRoot rev-parse HEAD).Trim()
$gitDirty = [bool](& git -C $projectRoot status --porcelain)
$manifest = [ordered]@{
    schemaVersion = 1; buildId = $buildId; builtAtUtc = [DateTime]::UtcNow.ToString('o')
    gitHead = $gitHead; workingTreeDirty = $gitDirty
    releaseVerified = ($runtimeMode -eq 'fixed' -and $smokeStatus -eq 'passed')
    toolchain = $lock; toolchainSha256 = Hash-File $lockPath
    compilerSha256 = Hash-File $csc; jlinkSha256 = Hash-File $jlink
    frontendLockSha256 = Hash-File (Join-Path $frontendDir 'package-lock.json')
    webView2 = @{ mode = $runtimeMode; version = $runtimeVersion; sourceExecutableSha256 = $runtimeSourceHash }
    validation = @{ frontend = 'typecheck, lint, build'; backend = 'Maven verify standalone'; desktopSmoke = $smokeStatus }
    files = File-Inventory $staging
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $staging 'release-manifest.json') -Encoding UTF8
Assert-ChildPath $staging $buildRoot
Assert-ChildPath $destination $outputRoot
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
Move-Item -LiteralPath $staging -Destination $destination
Write-Host "Package ready: $destination"
Write-Host "Manifest: $(Join-Path $destination 'release-manifest.json')"
