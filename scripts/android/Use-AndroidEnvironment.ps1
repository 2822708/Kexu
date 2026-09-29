[CmdletBinding()]
param(
    [string]$ToolRoot = 'E:\codex work\tools\android',
    [string]$JavaHome = ''
)

$androidToolRoot = [IO.Path]::GetFullPath($ToolRoot)
if (-not $JavaHome) {
    $androidJavaCandidates = @(
        'C:\Program Files\Microsoft\jdk-21.0.7.6-hotspot',
        (Join-Path $androidToolRoot 'studio\android-studio\jbr'),
        $env:JAVA_HOME
    )
    foreach ($androidJavaCandidate in $androidJavaCandidates) {
        if ($androidJavaCandidate -and (Test-Path -LiteralPath (Join-Path $androidJavaCandidate 'bin\java.exe'))) {
            $JavaHome = $androidJavaCandidate
            break
        }
    }
}
if (-not $JavaHome -or -not (Test-Path -LiteralPath (Join-Path $JavaHome 'bin\java.exe'))) {
    throw 'No JDK found. Pass -JavaHome with a JDK 17-23 path, or install Android Studio first.'
}

$env:JAVA_HOME = [IO.Path]::GetFullPath($JavaHome)
$env:ANDROID_TOOL_ROOT = $androidToolRoot
$env:ANDROID_HOME = Join-Path $androidToolRoot 'sdk'
if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME }
$env:GRADLE_USER_HOME = Join-Path $androidToolRoot 'gradle-user-home'
$env:ANDROID_USER_HOME = Join-Path $androidToolRoot 'android-user-home'
$env:ANDROID_EMULATOR_HOME = $env:ANDROID_USER_HOME
$env:ANDROID_AVD_HOME = Join-Path $androidToolRoot 'avd'
$env:STUDIO_PROPERTIES = Join-Path $androidToolRoot 'studio.properties'

$androidBins = @(
    (Join-Path $env:JAVA_HOME 'bin'),
    (Join-Path $androidToolRoot 'gradle\gradle-8.13\bin'),
    (Join-Path $env:ANDROID_HOME 'cmdline-tools\latest\bin'),
    (Join-Path $env:ANDROID_HOME 'platform-tools'),
    (Join-Path $env:ANDROID_HOME 'emulator')
)
$env:Path = (($androidBins + ($env:Path -split ';')) | Select-Object -Unique) -join ';'
