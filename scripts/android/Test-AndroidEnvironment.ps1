#requires -Version 5.1
<#
.SYNOPSIS
Read-only checks for the Tangent Timetable Windows Android toolchain.
.DESCRIPTION
Inspects files and version metadata without running SDK/Gradle commands,
downloading components, accepting licenses, or changing environment variables.
Exit code 0 means all required file checks passed; 1 means something is missing.
This does not prove that the project compiles or that an emulator can boot.
.EXAMPLE
.\Test-AndroidEnvironment.ps1
.EXAMPLE
.\Test-AndroidEnvironment.ps1 -AsJson
#>
[CmdletBinding()]
param(
    [string]$ToolRoot = 'E:\codex work\tools\android',
    [string]$ProjectRoot = '',
    [switch]$AsJson
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$checks = New-Object 'System.Collections.Generic.List[object]'
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Join-Path $PSScriptRoot '..\..\src\android'
}

function Add-Check {
    param(
        [string]$Name,
        [bool]$Okay,
        [string]$Path,
        [string]$Detail,
        [bool]$Required = $true
    )
    $state = 'missing'
    if ($Okay) { $state = 'okay' }
    $checks.Add([pscustomobject][ordered]@{
        name = $Name
        state = $state
        required = $Required
        path = $Path
        detail = $Detail
    })
}

function Test-FileCheck {
    param([string]$Name, [string]$Path, [string]$Detail)
    Add-Check -Name $Name -Okay (Test-Path -LiteralPath $Path -PathType Leaf) `
        -Path $Path -Detail $Detail
}

function ConvertFrom-JavaPropertyValue {
    param([string]$Value)
    # Decode Java .properties escapes, including Windows drive/backslash escapes.
    [regex]::Replace($Value, '\\(u[0-9a-fA-F]{4}|.)', {
        param($Match)
        $escaped = $Match.Groups[1].Value
        if ($escaped.StartsWith('u') -and $escaped.Length -eq 5) {
            return [string][char][Convert]::ToInt32($escaped.Substring(1), 16)
        }
        switch -CaseSensitive ($escaped) {
            't' { return "`t" }
            'r' { return "`r" }
            'n' { return "`n" }
            'f' { return [string][char]12 }
            default { return $escaped }
        }
    })
}

$ToolRoot = [IO.Path]::GetFullPath($ToolRoot)
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$sdkRoot = Join-Path $ToolRoot 'sdk'
$gradleRoot = Join-Path $ToolRoot 'gradle\gradle-8.13'
$studioRoot = Join-Path $ToolRoot 'studio\android-studio'

# Prefer the configured environment JDK, then Studio's bundled JDK, then the
# known Microsoft installation. Read release metadata instead of starting Java.
$javaCandidates = @()
if (-not [string]::IsNullOrWhiteSpace($env:JAVA_HOME)) {
    $javaCandidates += $env:JAVA_HOME
}
$javaCandidates += (Join-Path $studioRoot 'jbr')
$javaCandidates += 'C:\Program Files\Microsoft\jdk-21.0.7.6-hotspot'
$selectedJava = $null
$javaVersion = $null
foreach ($candidate in ($javaCandidates | Select-Object -Unique)) {
    $releasePath = Join-Path $candidate 'release'
    if (-not (Test-Path -LiteralPath (Join-Path $candidate 'bin\java.exe') -PathType Leaf)) { continue }
    if (-not (Test-Path -LiteralPath (Join-Path $candidate 'bin\javac.exe') -PathType Leaf)) { continue }
    if (-not (Test-Path -LiteralPath $releasePath -PathType Leaf)) { continue }
    try {
        $releaseText = Get-Content -LiteralPath $releasePath -Raw
        $versionMatch = [regex]::Match($releaseText, '(?m)^JAVA_VERSION="([^"]+)"')
        if (-not $versionMatch.Success) { continue }
        $candidateVersion = $versionMatch.Groups[1].Value
        $majorMatch = [regex]::Match($candidateVersion, '^([0-9]+)')
        if (-not $majorMatch.Success) { continue }
        $majorVersion = [int]$majorMatch.Groups[1].Value
        # AGP requires at least Java 17; Gradle 8.13 can run through Java 23.
        if ($majorVersion -ge 17 -and $majorVersion -le 23) {
            $selectedJava = [IO.Path]::GetFullPath($candidate)
            $javaVersion = $candidateVersion
            break
        }
    }
    catch { continue }
}
$javaDetail = 'A JDK 17-23 with java.exe, javac.exe and release metadata is required.'
if ($selectedJava) { $javaDetail = "JDK $javaVersion detected from release metadata." }
Add-Check -Name 'jdk' -Okay ([bool]$selectedJava) -Path $selectedJava -Detail $javaDetail

Test-FileCheck 'sdk.commandLineTools' (Join-Path $sdkRoot 'cmdline-tools\latest\bin\sdkmanager.bat') 'Android SDK command-line tools.'
Test-FileCheck 'sdk.platformTools' (Join-Path $sdkRoot 'platform-tools\adb.exe') 'ADB platform tools.'
Test-FileCheck 'sdk.platform36' (Join-Path $sdkRoot 'platforms\android-36\android.jar') 'Android API 36 compile platform.'
Test-FileCheck 'sdk.buildTools35' (Join-Path $sdkRoot 'build-tools\35.0.0\aapt2.exe') 'Android build tools 35.0.0.'
Test-FileCheck 'gradle.launcher' (Join-Path $gradleRoot 'bin\gradle.bat') 'Standalone Gradle launcher.'
Test-FileCheck 'gradle.version8.13' (Join-Path $gradleRoot 'lib\gradle-launcher-8.13.jar') 'Gradle 8.13 distribution version marker.'
Test-FileCheck 'studio' (Join-Path $studioRoot 'bin\studio64.exe') 'Android Studio Windows IDE.'
Test-FileCheck 'project.settings' (Join-Path $ProjectRoot 'settings.gradle.kts') 'Android Gradle project.'
Test-FileCheck 'wrapper.unix' (Join-Path $ProjectRoot 'gradlew') 'Gradle wrapper Unix launcher.'
Test-FileCheck 'wrapper.windows' (Join-Path $ProjectRoot 'gradlew.bat') 'Gradle wrapper Windows launcher.'
Test-FileCheck 'wrapper.jar' (Join-Path $ProjectRoot 'gradle\wrapper\gradle-wrapper.jar') 'Gradle wrapper bootstrap JAR.'

$wrapperProperties = Join-Path $ProjectRoot 'gradle\wrapper\gradle-wrapper.properties'
$wrapperVersionOkay = $false
$wrapperDetail = 'Wrapper properties must select gradle-8.13-bin.zip or gradle-8.13-all.zip.'
if (Test-Path -LiteralPath $wrapperProperties -PathType Leaf) {
    try {
        $wrapperText = Get-Content -LiteralPath $wrapperProperties -Raw
        $wrapperVersionOkay = $wrapperText -match '(?m)^\s*distributionUrl\s*=.*[/\\]gradle-8\.13-(bin|all)\.zip\s*$'
    }
    catch { $wrapperDetail = 'Wrapper properties could not be read.' }
}
Add-Check 'wrapper.version8.13' $wrapperVersionOkay $wrapperProperties $wrapperDetail

$wrapperChecksumOkay = $false
$wrapperChecksumDetail = 'Wrapper distributionSha256Sum must match the pinned toolchain manifest.'
$manifestPath = Join-Path $PSScriptRoot 'toolchain.json'
if ((Test-Path -LiteralPath $wrapperProperties -PathType Leaf) -and (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    try {
        $toolchainManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        $expectedChecksum = [string]$toolchainManifest.downloads.gradle.sha256
        $wrapperText = Get-Content -LiteralPath $wrapperProperties -Raw
        $checksumMatches = [regex]::Matches($wrapperText, '(?m)^\s*distributionSha256Sum\s*[=:]\s*([0-9a-fA-F]+)\s*$')
        if ($expectedChecksum -match '^[0-9a-fA-F]{64}$' -and $checksumMatches.Count -gt 0) {
            $configuredChecksum = $checksumMatches[$checksumMatches.Count - 1].Groups[1].Value
            $wrapperChecksumOkay = $configuredChecksum -ieq $expectedChecksum
        }
    }
    catch { $wrapperChecksumDetail = 'Wrapper properties or the pinned toolchain checksum could not be read.' }
}
Add-Check 'wrapper.distributionChecksum' $wrapperChecksumOkay $wrapperProperties $wrapperChecksumDetail

$localProperties = Join-Path $ProjectRoot 'local.properties'
$localSdkOkay = $false
$configuredSdk = $null
$localDetail = 'local.properties must contain sdk.dir pointing to the selected ToolRoot/sdk directory.'
if (Test-Path -LiteralPath $localProperties -PathType Leaf) {
    try {
        $localText = Get-Content -LiteralPath $localProperties -Raw
        $sdkMatches = [regex]::Matches($localText, '(?m)^[ \t]*sdk[.]dir[ \t]*[=:][ \t]*(.*?)[ \t]*\r?$')
        if ($sdkMatches.Count -gt 0) {
            # A later duplicate property overrides an earlier one in Java.
            $configuredSdk = ConvertFrom-JavaPropertyValue $sdkMatches[$sdkMatches.Count - 1].Groups[1].Value
            if (-not [string]::IsNullOrWhiteSpace($configuredSdk)) {
                if (-not [IO.Path]::IsPathRooted($configuredSdk)) {
                    $configuredSdk = Join-Path $ProjectRoot $configuredSdk
                }
                $configuredSdk = [IO.Path]::GetFullPath($configuredSdk)
                $sdkExists = Test-Path -LiteralPath $configuredSdk -PathType Container
                $sdkMatchesToolRoot = [string]::Equals($configuredSdk.TrimEnd([char[]]'\/'), $sdkRoot.TrimEnd([char[]]'\/'), [StringComparison]::OrdinalIgnoreCase)
                $localSdkOkay = $sdkExists -and $sdkMatchesToolRoot
                $localDetail = "Configured SDK: $configuredSdk"
                if (-not $sdkMatchesToolRoot) { $localDetail += "; expected: $sdkRoot" }
                elseif (-not $sdkExists) { $localDetail += '; directory is missing.' }
            }
        }
    }
    catch { $localDetail = 'local.properties is unreadable or sdk.dir is invalid.' }
}
Add-Check 'project.localSdk' $localSdkOkay $localProperties $localDetail

foreach ($directory in @('gradle-user-home', 'android-user-home', 'avd')) {
    $directoryPath = Join-Path $ToolRoot $directory
    Add-Check -Name "directory.$directory" `
        -Okay (Test-Path -LiteralPath $directoryPath -PathType Container) `
        -Path $directoryPath -Detail 'Optional isolated state directory; tools can create it when used.' -Required $false
}

$missing = @($checks | Where-Object { $_.required -and $_.state -eq 'missing' })
$ready = $missing.Count -eq 0
$result = [pscustomobject][ordered]@{
    checkedAtUtc = [DateTime]::UtcNow.ToString('o')
    ready = $ready
    scope = 'Read-only file and version metadata checks; no compilation or emulator validation.'
    toolRoot = $ToolRoot
    projectRoot = $ProjectRoot
    selectedJavaHome = $selectedJava
    selectedJavaVersion = $javaVersion
    configuredSdk = $configuredSdk
    missingRequired = @($missing | ForEach-Object { $_.name })
    checks = @($checks.ToArray())
}
if ($AsJson) {
    $result | ConvertTo-Json -Depth 5
}
else {
    Write-Output 'Tangent Timetable Android environment (read-only inspection)'
    foreach ($check in $checks) {
        $optional = ''
        if (-not $check.required) { $optional = ' (optional)' }
        Write-Output ('[{0}] {1}{2}: {3}' -f $check.state, $check.name, $optional, $check.detail)
    }
    if ($ready) {
        Write-Output 'READY: Required files are present. Build and device validation are still separate steps.'
    }
    else {
        Write-Output ('NOT READY: {0} required check(s) are missing.' -f $missing.Count)
    }
}
if ($ready) { exit 0 }
exit 1
