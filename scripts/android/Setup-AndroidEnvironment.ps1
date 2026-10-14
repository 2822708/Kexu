#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$ToolRoot = 'E:\codex work\tools\android',
    [string]$ProjectRoot = '',
    [string]$JavaHome = '',
    [switch]$ConfigureOnly,
    [switch]$SkipEmulator,
    [switch]$SkipBuild
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
if (-not $ProjectRoot) { $ProjectRoot = Join-Path $PSScriptRoot '..\..\src\android' }
$ToolRoot = [IO.Path]::GetFullPath($ToolRoot).TrimEnd('\', '/')
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$manifest = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'toolchain.json') | ConvertFrom-Json
$utf8 = New-Object Text.UTF8Encoding($false)

function Assert-ToolPath {
    param([string]$Path)
    $resolved = [IO.Path]::GetFullPath($Path)
    if (-not $resolved.StartsWith($ToolRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path is outside the selected tool directory: $resolved"
    }
    return $resolved
}

function Set-Property {
    param([string]$Path, [string]$Key, [string]$Value)
    $lines = @()
    if (Test-Path -LiteralPath $Path) {
        $pattern = '^\s*' + [regex]::Escape($Key) + '\s*[=:]'
        $lines = @(Get-Content -LiteralPath $Path | Where-Object { $_ -notmatch $pattern })
    }
    $lines += "$Key=$Value"
    [IO.File]::WriteAllLines($Path, [string[]]$lines, $utf8)
}

function Invoke-Native {
    param([string]$File, [string[]]$Arguments)
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$File failed with exit code $LASTEXITCODE." }
}

function Get-VerifiedArchive {
    param($Package)
    $url = [Uri]$Package.url
    if ($url.Scheme -ne 'https' -or $Package.sha256 -notmatch '^[0-9a-f]{64}$') {
        throw 'The download manifest requires HTTPS and a SHA-256 checksum.'
    }
    $archive = Assert-ToolPath (Join-Path $ToolRoot ('downloads\' + [IO.Path]::GetFileName($url.AbsolutePath)))
    if (Test-Path -LiteralPath $archive) {
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ieq $Package.sha256) {
            Write-Host "Using verified cache: $archive"
            return $archive
        }
        throw "Cached archive has the wrong SHA-256. Review/remove this file and retry: $archive"
    }
    $partial = Assert-ToolPath ($archive + '.partial')
    Write-Host "Downloading $($url.AbsoluteUri)"
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curl) {
        Invoke-Native -File $curl.Source -Arguments @('--fail', '--location', '--retry', '2', '--connect-timeout', '20', '--output', $partial, $url.AbsoluteUri)
    } else {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $url.AbsoluteUri -OutFile $partial -UseBasicParsing
    }
    if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ine $Package.sha256) {
        throw "Downloaded archive failed SHA-256 validation: $partial"
    }
    # Both absolute paths were checked against ToolRoot; this moves one file only.
    Move-Item -LiteralPath $partial -Destination $archive
    return $archive
}

function Save-Inspection {
    $report = Join-Path $ToolRoot 'environment-report.json'
    $json = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Test-AndroidEnvironment.ps1') -ToolRoot $ToolRoot -ProjectRoot $ProjectRoot -AsJson
    $inspectionExit = $LASTEXITCODE
    [IO.File]::WriteAllText($report, ($json -join [Environment]::NewLine), $utf8)
    if ($inspectionExit -notin @(0, 1)) { throw 'Environment inspection failed unexpectedly.' }
    Write-Host "Environment report: $report"
    return ($json -join [Environment]::NewLine | ConvertFrom-Json)
}

if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'settings.gradle.kts'))) {
    throw "Android project root is invalid: $ProjectRoot"
}
if (-not [Environment]::Is64BitOperatingSystem) { throw 'This setup requires 64-bit Windows.' }

foreach ($directory in @('', 'downloads', 'sdk', 'sdk\cmdline-tools', 'gradle', 'gradle-user-home', 'android-user-home', 'avd', 'studio', 'studio-state\config', 'studio-state\system', 'studio-state\plugins', 'studio-state\log', 'wrapper-bootstrap')) {
    New-Item -ItemType Directory -Path (Join-Path $ToolRoot $directory) -Force | Out-Null
}
. (Join-Path $PSScriptRoot 'Use-AndroidEnvironment.ps1') -ToolRoot $ToolRoot -JavaHome $JavaHome
$javaRelease = Get-Content -Raw -LiteralPath (Join-Path $env:JAVA_HOME 'release')
$javaMatch = [regex]::Match($javaRelease, '(?m)^JAVA_VERSION="(\d+)')
if (-not $javaMatch.Success -or [int]$javaMatch.Groups[1].Value -lt 17 -or [int]$javaMatch.Groups[1].Value -gt 23) {
    throw 'Gradle 8.13 requires a compatible runtime. Select JDK 17-23 with -JavaHome; this machine has Microsoft JDK 21.'
}

Set-Property (Join-Path $ProjectRoot 'local.properties') 'sdk.dir' ($env:ANDROID_HOME.Replace('\', '/'))
Set-Property (Join-Path $env:GRADLE_USER_HOME 'gradle.properties') 'org.gradle.java.home' ($env:JAVA_HOME.Replace('\', '/'))
New-Item -ItemType Directory -Path (Join-Path $ProjectRoot '.gradle') -Force | Out-Null
Set-Property (Join-Path $ProjectRoot '.gradle\config.properties') 'java.home' ($env:JAVA_HOME.Replace('\', '/'))
foreach ($part in @('config', 'system', 'plugins', 'log')) {
    Set-Property $env:STUDIO_PROPERTIES "idea.$part.path" ((Join-Path $ToolRoot "studio-state\$part").Replace('\', '/'))
}
$environmentScript = ". '" + (Join-Path $PSScriptRoot 'Use-AndroidEnvironment.ps1').Replace("'", "''") + "' -ToolRoot '" + $ToolRoot.Replace("'", "''") + "' -JavaHome '" + $env:JAVA_HOME.Replace("'", "''") + "'"
[IO.File]::WriteAllText((Join-Path $ToolRoot 'environment.ps1'), $environmentScript + [Environment]::NewLine, $utf8)
Write-Host "Project: $ProjectRoot"
Write-Host "Tools:   $ToolRoot"
Write-Host "Java:    $env:JAVA_HOME"

if ($ConfigureOnly) {
    $inspection = Save-Inspection
    Write-Host "Local configuration prepared. Missing required checks: $($inspection.missingRequired.Count)."
    Write-Host 'No software was downloaded, no license was accepted, and no build was run in ConfigureOnly mode.'
    exit 0
}

$sdkManager = Join-Path $env:ANDROID_HOME 'cmdline-tools\latest\bin\sdkmanager.bat'
$studioExe = Join-Path $ToolRoot 'studio\android-studio\bin\studio64.exe'
$gradleExe = Join-Path $ToolRoot 'gradle\gradle-8.13\bin\gradle.bat'

# The human running setup reviews and accepts Google's terms. Never auto-answer
# SDK license questions or prepopulate SDK license acceptance files.
if (-not (Test-Path -LiteralPath $sdkManager) -or -not (Test-Path -LiteralPath $studioExe)) {
    Write-Host 'Google requires agreement to the Android SDK terms before downloading its tools.'
    Write-Host 'Review: https://developer.android.com/studio#downloads'
    $agreement = Read-Host 'After reviewing and accepting those terms yourself, type ACCEPT to download; anything else stops setup'
    if ($agreement -cne 'ACCEPT') { throw 'Setup stopped before downloading Google tools. Local configuration has been kept.' }
}

if (-not (Test-Path -LiteralPath $gradleExe)) {
    $gradleArchive = Get-VerifiedArchive $manifest.downloads.gradle
    Expand-Archive -LiteralPath $gradleArchive -DestinationPath (Join-Path $ToolRoot 'gradle') -Force
}
if (-not (Test-Path -LiteralPath $sdkManager)) {
    $cliArchive = Get-VerifiedArchive $manifest.downloads.commandLineTools
    $extractedCli = Assert-ToolPath (Join-Path $env:ANDROID_HOME 'cmdline-tools\cmdline-tools')
    $latestCli = Assert-ToolPath (Join-Path $env:ANDROID_HOME 'cmdline-tools\latest')
    if (Test-Path -LiteralPath $latestCli) { throw "Incomplete command-line tools directory exists; review it before retrying: $latestCli" }
    Expand-Archive -LiteralPath $cliArchive -DestinationPath (Join-Path $env:ANDROID_HOME 'cmdline-tools') -Force
    if (-not (Test-Path -LiteralPath (Join-Path $extractedCli 'bin\sdkmanager.bat'))) { throw 'Unexpected command-line tools archive layout.' }
    # Source and destination were resolved and checked to remain under ToolRoot.
    Move-Item -LiteralPath $extractedCli -Destination $latestCli
}
if (-not (Test-Path -LiteralPath $studioExe)) {
    $studioArchive = Get-VerifiedArchive $manifest.downloads.studio
    Expand-Archive -LiteralPath $studioArchive -DestinationPath (Join-Path $ToolRoot 'studio') -Force
}

Write-Host 'SDK Manager will show any licenses that still need your own acceptance.'
Invoke-Native $sdkManager @("--sdk_root=$env:ANDROID_HOME", '--licenses')
$packages = @('platform-tools', ('platforms;' + $manifest.platform), ('build-tools;' + $manifest.buildTools), ('sources;' + $manifest.platform))
if (-not $SkipEmulator) { $packages += @('emulator', $manifest.systemImage) }
Invoke-Native $sdkManager (@("--sdk_root=$env:ANDROID_HOME", '--channel=0') + $packages)

if (-not $SkipEmulator) {
    $avdManager = Join-Path $env:ANDROID_HOME 'cmdline-tools\latest\bin\avdmanager.bat'
    $avdIni = Join-Path $env:ANDROID_AVD_HOME ($manifest.avdName + '.ini')
    if (-not (Test-Path -LiteralPath $avdIni)) {
        # This answers only the optional custom hardware-profile question.
        'no' | & $avdManager create avd --name $manifest.avdName --package $manifest.systemImage --path (Join-Path $env:ANDROID_AVD_HOME ($manifest.avdName + '.avd'))
        if ($LASTEXITCODE -ne 0) { throw 'AVD creation failed.' }
    }
    & (Join-Path $env:ANDROID_HOME 'emulator\emulator.exe') -accel-check
    if ($LASTEXITCODE -ne 0) {
        Write-Warning 'Emulator files are installed, but hardware acceleration is unavailable. Check BIOS virtualization / Windows Hypervisor Platform; an administrator and restart may be needed.'
    }
}

$wrapperFiles = @('gradlew', 'gradlew.bat', 'gradle\wrapper\gradle-wrapper.jar', 'gradle\wrapper\gradle-wrapper.properties')
$missingWrapper = @($wrapperFiles | Where-Object { -not (Test-Path -LiteralPath (Join-Path $ProjectRoot $_)) })
if ($missingWrapper.Count -gt 0) {
    $bootstrap = Join-Path $ToolRoot 'wrapper-bootstrap'
    [IO.File]::WriteAllText((Join-Path $bootstrap 'settings.gradle'), "rootProject.name = 'android-wrapper-bootstrap'", $utf8)
    [IO.File]::WriteAllText((Join-Path $bootstrap 'build.gradle'), '', $utf8)
    Invoke-Native $gradleExe @('--no-daemon', '-p', $bootstrap, 'wrapper', '--gradle-version', $manifest.gradleVersion, '--distribution-type', 'bin', '--gradle-distribution-sha256-sum', $manifest.downloads.gradle.sha256)
    $generatedJar = Join-Path $bootstrap 'gradle\wrapper\gradle-wrapper.jar'
    if ((Get-FileHash -LiteralPath $generatedJar -Algorithm SHA256).Hash -ine $manifest.wrapperJarSha256) {
        throw 'Generated Gradle wrapper JAR checksum differs from the official release checksum.'
    }
    foreach ($relativePath in $missingWrapper) {
        $target = Join-Path $ProjectRoot $relativePath
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $bootstrap $relativePath) -Destination $target
    }
}
$projectWrapperJar = Join-Path $ProjectRoot 'gradle\wrapper\gradle-wrapper.jar'
if ((Get-FileHash -LiteralPath $projectWrapperJar -Algorithm SHA256).Hash -ine $manifest.wrapperJarSha256) {
    throw 'Project wrapper JAR is not the pinned official Gradle 8.13 wrapper.'
}
Set-Property (Join-Path $ProjectRoot 'gradle\wrapper\gradle-wrapper.properties') 'distributionSha256Sum' $manifest.downloads.gradle.sha256

$inspection = Save-Inspection
if (-not $inspection.ready) { throw ('Required components remain missing: ' + ($inspection.missingRequired -join ', ')) }
Invoke-Native (Join-Path $env:JAVA_HOME 'bin\java.exe') @('-version')
Invoke-Native $gradleExe @('--no-daemon', '--version')
Invoke-Native (Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe') @('version')
if (-not $SkipBuild) {
    & (Join-Path $PSScriptRoot 'Invoke-Android.ps1') -Action Build -ToolRoot $ToolRoot -ProjectRoot $ProjectRoot -JavaHome $env:JAVA_HOME
    Write-Host ('Debug APK: ' + (Join-Path $ProjectRoot 'app\build\outputs\apk\debug\app-debug.apk'))
    Write-Host 'Review and commit generated Room schema JSON and Gradle wrapper files after the build passes.'
}
Write-Host 'Environment installation completed. Open the project with Open-AndroidStudio.cmd.'
if ($SkipBuild) { Write-Host 'Build was explicitly skipped; no compilation or APK claim is made.' }
