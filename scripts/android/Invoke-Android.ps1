[CmdletBinding()]
param(
    [ValidateSet('Studio', 'Build', 'Test', 'Devices', 'Emulator', 'Shell')]
    [string]$Action = 'Studio',
    [string]$ToolRoot = 'E:\codex work\tools\android',
    [string]$ProjectRoot = '',
    [string]$JavaHome = ''
)

$ErrorActionPreference = 'Stop'
if (-not $ProjectRoot) { $ProjectRoot = Join-Path $PSScriptRoot '..\..\src\android' }
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
. (Join-Path $PSScriptRoot 'Use-AndroidEnvironment.ps1') -ToolRoot $ToolRoot -JavaHome $JavaHome
switch ($Action) {
    'Studio' {
        $studio = Join-Path $ToolRoot 'studio\android-studio\bin\studio64.exe'
        if (-not (Test-Path -LiteralPath $studio)) { throw 'Android Studio is missing. Run Setup-Android.cmd first.' }
        # Studio uses its bundled runtime. JAVA_HOME is for the project Gradle process.
        Start-Process -FilePath $studio -ArgumentList ('"' + $ProjectRoot + '"')
    }
    { $_ -in 'Build', 'Test' } {
        $wrapper = Join-Path $ProjectRoot 'gradlew.bat'
        if (-not (Test-Path -LiteralPath $wrapper)) { throw 'Gradle Wrapper is missing. Run Setup-Android.cmd first.' }
        Push-Location $ProjectRoot
        try {
            if ($Action -eq 'Build') { & $wrapper --no-daemon ':app:testDebugUnitTest' ':app:assembleDebug' }
            else { & $wrapper --no-daemon ':app:connectedDebugAndroidTest' }
            if ($LASTEXITCODE -ne 0) { throw "Gradle failed with exit code $LASTEXITCODE." }
        } finally { Pop-Location }
    }
    'Devices' {
        & (Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe') devices -l
        if ($LASTEXITCODE -ne 0) { throw 'adb failed.' }
    }
    'Emulator' {
        $emulator = Join-Path $env:ANDROID_HOME 'emulator\emulator.exe'
        if (-not (Test-Path -LiteralPath $emulator)) { throw 'Emulator is missing. Re-run Setup-Android.cmd without -SkipEmulator.' }
        & $emulator -accel-check
        if ($LASTEXITCODE -ne 0) {
            throw 'Hardware acceleration is unavailable. Check BIOS virtualization and Windows Hypervisor Platform, then restart Windows if needed.'
        }
        Start-Process -FilePath $emulator -ArgumentList '-avd Tangent_API_36 -no-snapshot-load'
    }
    'Shell' {
        Set-Location $ProjectRoot
        Write-Host "Android environment loaded. Project: $ProjectRoot"
        Write-Host 'Commands: .\gradlew.bat :app:assembleDebug | adb devices'
    }
}
