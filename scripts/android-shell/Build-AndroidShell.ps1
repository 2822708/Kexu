[CmdletBinding()]
param(
    [string]$ToolRoot = 'E:\codex work\tools\android',
    [string]$JavaHome = 'C:\Program Files\Microsoft\jdk-21.0.7.6-hotspot',
    [string]$SigningRoot,
    [switch]$Release,
    [switch]$SkipWebBuild,
    [switch]$Offline
)
$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$project = Join-Path $repository 'src\android-shell'
$frontend = Join-Path $repository 'src\frontend'
$source = Join-Path $frontend 'dist-shell'
$assetRoot = Join-Path $project 'app\src\main\assets'
$assetDestination = [IO.Path]::GetFullPath((Join-Path $assetRoot 'www'))
if (-not $assetDestination.StartsWith($project + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe assets directory.' }
$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = Join-Path $ToolRoot 'sdk'
$env:ANDROID_USER_HOME = Join-Path $ToolRoot 'android-user-home'
if ($env:ANDROID_SDK_HOME) { Remove-Item Env:ANDROID_SDK_HOME }
$env:GRADLE_USER_HOME = Join-Path $ToolRoot 'gradle-user-home'
$env:Path = (Join-Path $JavaHome 'bin') + ';' + $env:Path
if (-not $SkipWebBuild) {
    Push-Location $frontend
    try { & npm.cmd run build:shell; if ($LASTEXITCODE -ne 0) { throw 'Frontend shell build failed.' } }
    finally { Pop-Location }
}
if (-not (Test-Path -LiteralPath (Join-Path $source 'index.html'))) { throw 'Run npm run build:shell first.' }
if ((Test-Path -LiteralPath (Join-Path $source 'sw.js')) -or (Get-Content -LiteralPath (Join-Path $source 'index.html') -Raw).Contains('manifest.webmanifest')) { throw 'PWA build is not a native-shell input.' }
if (Test-Path -LiteralPath $assetDestination) { Remove-Item -LiteralPath $assetDestination -Recurse -Force }
New-Item -ItemType Directory -Path $assetDestination -Force | Out-Null
# Copy each verified source child, including nested hashed resources.
Get-ChildItem -LiteralPath $source | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $assetDestination -Recurse -Force }
$paths = @(Get-ChildItem -LiteralPath $assetDestination -File -Recurse | ForEach-Object { $_.FullName.Substring($assetDestination.Length + 1).Replace('\', '/') } | Sort-Object)
[IO.File]::WriteAllLines((Join-Path $assetRoot 'shell-assets.txt'), $paths, [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $project 'local.properties'), 'sdk.dir=' + $env:ANDROID_HOME.Replace('\', '/') + "`n", [Text.UTF8Encoding]::new($false))
$gradle = Join-Path $ToolRoot 'gradle\gradle-8.13\bin\gradle.bat'
$arguments = @('--no-daemon', '--console=plain', ('-Duser.home=' + $env:ANDROID_USER_HOME), 'testDebugUnitTest', 'assembleDebug')
if ($Release) {
    $privateRoot = if ($SigningRoot) { [IO.Path]::GetFullPath($SigningRoot) } else { Join-Path $ToolRoot 'signing\Kexu' }
    $privateRootCreated = -not (Test-Path -LiteralPath $privateRoot)
    New-Item -ItemType Directory -Path $privateRoot -Force | Out-Null
    if ($privateRootCreated) {
        $privateOwner = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        & icacls.exe $privateRoot /inheritance:r /grant:r ("*$($privateOwner):(OI)(CI)F") | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Cannot protect the private signing directory.' }
    }
    $env:KEXU_ANDROID_SIGNING_PROPERTIES = Join-Path $privateRoot 'signing.properties'
    $keyStore = Join-Path $privateRoot 'kexu-release.jks'
    $previousRoot = Join-Path $repository 'work\private\android-shell'
    $previousProperties = Join-Path $previousRoot 'signing.properties'
    if (-not (Test-Path -LiteralPath $env:KEXU_ANDROID_SIGNING_PROPERTIES) -and (Test-Path -LiteralPath $previousProperties)) {
        if (Test-Path -LiteralPath $keyStore) { throw 'Existing signing key requires its original configuration. Refusing to replace it.' }
        Copy-Item -LiteralPath (Join-Path $previousRoot 'kexu-release.jks') -Destination $keyStore
        $previousConfiguration = [IO.File]::ReadAllText($previousProperties)
        $configuration = [regex]::Replace($previousConfiguration, '(?m)^storeFile=.*$', 'storeFile=' + $keyStore.Replace('\', '/'))
        [IO.File]::WriteAllText($env:KEXU_ANDROID_SIGNING_PROPERTIES, $configuration, [Text.UTF8Encoding]::new($false))
        $previousConfiguration = $null
        $configuration = $null
    }
    if (-not (Test-Path -LiteralPath $env:KEXU_ANDROID_SIGNING_PROPERTIES)) {
        if (Test-Path -LiteralPath $keyStore) { throw 'Existing keystore has no signing configuration. Restore the private configuration instead of replacing the key.' }
        $randomBytes = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($randomBytes) } finally { $rng.Dispose() }
        $signingPassword = [Convert]::ToBase64String($randomBytes)
        $env:KEXU_SIGNING_PASSWORD = $signingPassword
        & (Join-Path $JavaHome 'bin\keytool.exe') -genkeypair -keystore $keyStore -storetype JKS -storepass:env KEXU_SIGNING_PASSWORD -keypass:env KEXU_SIGNING_PASSWORD -alias kexu-release -keyalg RSA -keysize 3072 -validity 36500 -dname 'CN=Kexu Local Release, O=Kexu, C=CN'
        if ($LASTEXITCODE -ne 0) { throw 'Release key creation failed.' }
        $properties = "storeFile=$($keyStore.Replace('\', '/'))`nstorePassword=$signingPassword`nkeyAlias=kexu-release`nkeyPassword=$signingPassword`n"
        [IO.File]::WriteAllText($env:KEXU_ANDROID_SIGNING_PROPERTIES, $properties, [Text.UTF8Encoding]::new($false))
        Remove-Item Env:KEXU_SIGNING_PASSWORD
        $signingPassword = $null
    }
    $arguments += 'assembleRelease'
}
if ($Offline) { $arguments += '--offline' }
Push-Location $project
try {
    & $gradle @arguments
    if ($LASTEXITCODE -ne 0) { throw "Gradle failed ($LASTEXITCODE)." }
} finally { Pop-Location }
$apks = @(Join-Path $project 'app\build\outputs\apk\debug\app-debug.apk')
if ($Release) { $apks += Join-Path $project 'app\build\outputs\apk\release\app-release.apk' }
foreach ($apk in $apks) { Get-FileHash -LiteralPath $apk -Algorithm SHA256 | Select-Object Path, Hash }
