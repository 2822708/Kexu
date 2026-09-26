<#
.SYNOPSIS
    构建「大切课程表」Windows 免安装桌面版。

.DESCRIPTION
    一条命令完成：前端构建 → 打包含前端的 Spring Boot fat jar → jlink 裁剪 JRE →
    下载/解出 WebView2 SDK → 用系统自带 csc 编译 WinForms+WebView2 外壳 → 组装免安装目录。

    产物是一个可直接拷走运行的目录（默认 <仓库>/desktop/app-image/TangentTimetable），
    零外部依赖：不需要用户安装 Java、Node 或数据库。

.PARAMETER OutputDir
    输出目录。默认 <脚本目录>\app-image。

.PARAMETER SkipWebView2Download
    复用已解出的 WebView2 SDK（位于 %TEMP%\webview2-sdk\extract）而不重新下载。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File desktop\build-desktop.ps1
#>
[CmdletBinding()]
param(
    [string]$OutputDir,
    [switch]$SkipWebView2Download
)

$ErrorActionPreference = 'Stop'

$desktopDir = $PSScriptRoot
$repoRoot   = Split-Path $desktopDir -Parent
$backend    = Join-Path $repoRoot 'backend'
$frontend   = Join-Path $repoRoot 'frontend'
$shellDir   = Join-Path $desktopDir 'shell'
if (-not $OutputDir) { $OutputDir = Join-Path $desktopDir 'app-image' }
$dist = Join-Path $OutputDir 'TangentTimetable'

# H2 之外还需要这些 JDK 模块：Spring Boot 用到 sql/naming/net.http/management，
# Rhino 与 Jackson 用到 unsupported/compiler，jdk.zipfs 供 H2/资源读取。
$jlinkModules = @(
    'java.base', 'java.compiler', 'java.desktop', 'java.instrument', 'java.management',
    'java.naming', 'java.net.http', 'java.prefs', 'java.rmi', 'java.scripting',
    'java.security.jgss', 'java.sql', 'java.transaction.xa', 'java.xml',
    'jdk.crypto.ec', 'jdk.unsupported', 'jdk.jfr', 'jdk.zipfs'
) -join ','

function Write-Step($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }

# ---------- 0. 前置检查 ----------
Write-Step '0/7 前置检查'

$javaHome = (Get-Command java -ErrorAction SilentlyContinue).Source
if (-not $javaHome) { throw '未找到 java，请先安装 JDK 17+。' }
$javaHome = Split-Path (Split-Path $javaHome -Parent) -Parent
$jlink = Join-Path $javaHome 'bin\jlink.exe'
if (-not (Test-Path $jlink)) { throw "未找到 jlink：$jlink（需要完整 JDK，而非仅 JRE）" }

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "未找到 .NET Framework 编译器：$csc" }

$webView2Runtime = Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' -ErrorAction SilentlyContinue
if (-not $webView2Runtime) {
    Write-Warning '未检测到 WebView2 Runtime。目标机器若也没有，需要先安装（Win10/11 通常自带）。'
}

Write-Host "JDK   : $javaHome"
Write-Host "csc   : $csc"
Write-Host "输出  : $dist"

# ---------- 1. 前端 ----------
Write-Step '1/7 构建前端（vite build）'
Push-Location $frontend
try {
    if (-not (Test-Path (Join-Path $frontend 'node_modules'))) { & npm install }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw '前端构建失败' }
} finally { Pop-Location }

# ---------- 2. 含前端的 fat jar ----------
Write-Step '2/7 打包后端（-Pstandalone：前端产物并入 jar + H2 运行时依赖）'
Push-Location $backend
try {
    & .\mvnw.cmd -q -B -ntp package -Pstandalone -DskipTests
    if ($LASTEXITCODE -ne 0) { throw '后端打包失败' }
} finally { Pop-Location }
$jar = Join-Path $backend 'target\timetable-backend-1.0.0.jar'
if (-not (Test-Path $jar)) { throw "未生成 $jar" }

# ---------- 3. jlink ----------
Write-Step '3/7 jlink 裁剪运行时'
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $dist 'app') | Out-Null
& $jlink --add-modules $jlinkModules --strip-debug --no-header-files --no-man-pages `
    --compress=zip-6 --output (Join-Path $dist 'runtime')
if ($LASTEXITCODE -ne 0) { throw 'jlink 失败' }
Copy-Item $jar (Join-Path $dist 'app\timetable-backend.jar') -Force

# ---------- 4. WebView2 SDK ----------
Write-Step '4/7 准备 WebView2 SDK（仅编译期需要 net462 的程序集与原生 Loader）'
$sdkRoot = Join-Path $env:TEMP 'webview2-sdk'
$extract = Join-Path $sdkRoot 'extract'
if ($SkipWebView2Download -and (Test-Path (Join-Path $extract 'lib\net462'))) {
    Write-Host "复用已解出的 SDK：$extract"
} else {
    New-Item -ItemType Directory -Force -Path $sdkRoot | Out-Null
    $index = Invoke-RestMethod 'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/index.json'
    $version = ($index.versions | Where-Object { $_ -notmatch '-' })[-1]
    $nupkg = Join-Path $sdkRoot 'webview2.nupkg'
    $url = "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$version/microsoft.web.webview2.$version.nupkg"
    Write-Host "下载 Microsoft.Web.WebView2 $version"
    Invoke-WebRequest $url -OutFile $nupkg
    if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
    # 用 .NET 解压：Expand-Archive 只接受 .zip 扩展名，而 nupkg 本身就是 zip
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($nupkg, $extract)
}
Copy-Item (Join-Path $extract 'lib\net462\Microsoft.Web.WebView2.Core.dll') $dist -Force
Copy-Item (Join-Path $extract 'lib\net462\Microsoft.Web.WebView2.WinForms.dll') $dist -Force
Copy-Item (Join-Path $extract 'runtimes\win-x64\native\WebView2Loader.dll') $dist -Force

# ---------- 5. 外壳 ----------
Write-Step '5/7 编译桌面外壳（WinForms + WebView2，用 .NET Framework 自带 csc）'
$icon = Join-Path $shellDir 'app.ico'
$manifest = Join-Path $shellDir 'app.manifest'
$cscArgs = @(
    '/nologo', '/target:winexe', '/platform:x64', '/optimize+',
    "/out:$dist\TangentTimetable.exe",
    '/reference:System.dll', '/reference:System.Drawing.dll',
    '/reference:System.Windows.Forms.dll', '/reference:System.Core.dll',
    "/reference:$dist\Microsoft.Web.WebView2.Core.dll",
    "/reference:$dist\Microsoft.Web.WebView2.WinForms.dll"
)
if (Test-Path $icon) { $cscArgs += "/win32icon:$icon" }
# DPI 感知清单：缺失时在高 DPI 屏幕上整个界面会被系统位图放大而发虚
if (Test-Path $manifest) { $cscArgs += "/win32manifest:$manifest" }
$cscArgs += (Join-Path $shellDir 'Program.cs')
& $csc @cscArgs
if ($LASTEXITCODE -ne 0) { throw '外壳编译失败' }

# WinForms 的 PerMonitorV2 需要这份配置才生效（必须与 exe 同名 + .config）
$exeConfig = Join-Path $shellDir 'TangentTimetable.exe.config'
if (Test-Path $exeConfig) { Copy-Item $exeConfig "$dist\TangentTimetable.exe.config" -Force }

# ---------- 6. 汇总 ----------
Write-Step '6/7 体积汇总'
$total = (Get-ChildItem $dist -Recurse -File | Measure-Object Length -Sum).Sum
Get-ChildItem $dist | ForEach-Object {
    if ($_.PSIsContainer) {
        $size = (Get-ChildItem $_.FullName -Recurse -File | Measure-Object Length -Sum).Sum
        '{0,-40} {1,8:N1} MB' -f ($_.Name + '\'), ($size / 1MB)
    } else {
        '{0,-40} {1,8:N0} KB' -f $_.Name, ($_.Length / 1KB)
    }
}
'{0,-40} {1,8:N1} MB' -f '合计', ($total / 1MB)

# ---------- 7. 冒烟 ----------
Write-Step '7/7 冒烟：启动外壳，等内置后端就绪，再关窗'
$proc = Start-Process -FilePath (Join-Path $dist 'TangentTimetable.exe') -PassThru
$ready = $false
for ($i = 1; $i -le 90; $i++) {
    Start-Sleep -Seconds 1
    if (Get-NetTCPConnection -LocalPort 17817 -State Listen -ErrorAction SilentlyContinue) { $ready = $true; break }
    if ($proc.HasExited) { break }
}
if ($ready) {
    Write-Host '内置后端已就绪，窗口已打开 ✓' -ForegroundColor Green
    Start-Sleep -Seconds 3
    $proc.CloseMainWindow() | Out-Null
    Start-Sleep -Seconds 3
    $left = @(Get-Process javaw -ErrorAction SilentlyContinue).Count
    if ($left -eq 0) { Write-Host '关窗后后端已一并退出 ✓' -ForegroundColor Green }
    else { Write-Warning "关窗后仍有 $left 个 javaw 进程" }
} else {
    Write-Warning '冒烟未通过：内置后端未在 90 秒内就绪，请查看 %LOCALAPPDATA%\TangentTimetable\logs\timetable.log'
}

Write-Host "`n完成。产物目录：$dist" -ForegroundColor Green
Write-Host '整个目录拷到任何 Windows 10/11 x64 机器即可双击运行（无需 Java / Node / 数据库）。'
