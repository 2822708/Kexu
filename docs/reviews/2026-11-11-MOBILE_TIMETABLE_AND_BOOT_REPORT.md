# 手机课表、启动加载与预览问题报告

- 日期：2026-11-11
- 分支：`release/2026.11.10.1`
- 发行源码提交：`2745986 chore: bump version to 2026.11.11.2`
- 版本：`2026.11.11.2` / `2026111102`
- 范围：手机课表显示、启动加载页、左右滑动、本地预览、本地发行包
- 结论：加载页本身是代码里的正常界面，不是浏览器错误页；长时间停留是浏览器本机数据（IndexedDB）未及时响应，已用 10 秒超时和错误提示兜底。课表已按要求加长并允许上下滚动。

## 启动页复核（2026-11-11）

下文保留 `2026.11.11.2` 的原始记录。使用独立 Edge 配置和 Android WebView 的内容安全策略复现了三个遗漏场景。入口脚本请求失败会让静态启动页一直转圈，首次路由脚本请求失败会造成白屏，IndexedDB 打开成功后初始化事务仍可能迟迟不返回。仅测试 `indexedDB.open` 无法区分这些情况。

`2026.11.11.3` 将静态启动、读取本机数据和首次路由加载统一为「圆环 + 完美人生正在到来」。入口脚本和路由加载失败会显示「重新加载」，本机数据启动的初始化、维护和首读共用 15 秒上限。深色启动由同源脚本处理。重试通过重新加载页面释放当前连接并保留站点数据。旧记录中清除站点数据的提示会移除本机数据库，已从应用中删除。

## 1. 问题清单

| # | 现象 | 归属 | 根因 | 处理 |
|---|---|---|---|---|
| 1 | 手机上仍看到“正在打开 Kexu”旧启动页 | 旧安装包/缓存 | 当前源码和包内索引页早已换成「圆圈 + 完美人生正在到来」 | 版本提升到 `2026.11.11.2`，覆盖安装；PWA 关闭重开两次 |
| 2 | 加载页文字竖排、一字一行 | 代码 bug | Ant Design `Spin tip` 放在宽度为 0 的容器里 | 改成 `Spin` + 普通段落，横排居中 |
| 3 | 加载页长时间停在“正在打开本机数据” | 浏览器存储 + 缺少兜底 | `indexedDB.open` 在个别配置下既不成功也不报错（另一标签占用、站点数据异常、受限 WebView） | 增加 10 秒超时，失败显示错误原因和「重试」 |
| 4 | 预览页里课表一直停在加载页 | 预览方式 | 预览页用 iframe 嵌课表，iframe 又依赖同一份本机存储；部分浏览器/内嵌窗口不响应 | 预览页改为静态实拍图 + 独立手机窗口，不再依赖 iframe |
| 5 | 课表行太矮，课程名被截断，看不到地点和时间 | 代码 | ≤640px 的媒体查询隐藏了地点/教师和时间，行高只有 34–52px | 行高下限 64px，恢复地点、节次时间和日期 |
| 6 | 手机课表页不能上下滚动 | 代码 | 滑动容器参与 flex 拉伸，主内容区没有拿到滚动高度 | `.swipe-viewport` 改为 `flex: 0 0 auto`，由 `.app-content` 纵向滚动 |
| 7 | 左右滑动不跟手、看不到相邻页 | 代码 | 单页轨道只能看到位移，没有挂载真实相邻路由 | 双页轨道 + 邻页真实路由挂载，原生非 passive `touchmove` |

## 2. 诊断方法与证据

### 2.1 加载页到底是哪来的

- 静态启动页在 `src/frontend/index.html`：`boot-splash`，文案「完美人生正在到来」。
- 运行时加载页在 `src/frontend/src/App.tsx`：`BootLoading`，本地模式 `ready=false` 时显示「正在打开本机数据」。
- 因此「正在打开本机数据」不是浏览器错误页，也不是旧启动页，而是应用自己的数据加载阶段。

### 2.2 用 Edge + DevTools 协议实测

使用独立 Edge 配置打开 `http://127.0.0.1:5190/timetable`，在 1s / 3s / 6s / 12s 检查：

| 时间 | 状态 |
|---|---|
| 1s | `app-loading-page` 存在，`ready=false` |
| 3s | 课表已渲染，11 门课，加载页消失 |
| 6s | 保持正常 |
| 12s | 保持正常 |

同时：

- `indexedDB.databases()` 返回 `tangent-timetable-local-v1` version 2
- 页面内直接 `indexedDB.open(..., 2)` 4 秒内成功
- 控制台无异常，只有 React Router / antd 的弃用警告

结论：正常配置下加载页是 2–3 秒的开发服务器启动开销，不是死循环。开发模式首次要加载 40–60 个模块；打包版无此开销。

### 2.3 为什么会超过 10 秒

用户环境的截图显示过 10 秒后的错误提示：

> 本机数据暂时无法打开 / 打开本机数据超时，请关闭其他课表页面，或清除本站数据后重试

这说明该浏览器上下文里 `indexedDB.open` 没有回调。常见来源：

- 同一个地址还有其它课表标签页占着数据库连接
- 该站点的本机数据损坏或被清理
- 桌面应用的内嵌 WebView / 无痕模式限制了本地存储

代码现在不会无限转圈，10 秒后给出可操作提示。

## 3. 代码位置

### 启动与加载

- `src/frontend/index.html:20-60`：启动页样式与文案「完美人生正在到来」
- `src/frontend/src/App.tsx:29-38`：`BootLoading`（圆圈 + 横排文字）
- `src/frontend/src/App.tsx:53-66`：本地模式加载与错误分支
- `src/frontend/src/mobile.css:1-24`：`.app-loading-page`、`.app-loading-block`、错误提示宽度
- `src/frontend/src/local/db.ts:40-89`：`DB_OPEN_TIMEOUT_MS = 10_000` 与 `blocked` / 超时处理

### 手机课表

- `src/frontend/src/timetable-grid.css:33-58`：≤640px 行高 64px、显示地点、节次时间、日期
- `src/frontend/src/timetable-grid.css:24`：桌面行高下限 68px
- `src/frontend/src/timetable-grid.css:108`：课程块 meta（地点/教师）基础样式

### 滑动翻页与滚动

- `src/frontend/src/components/SwipePager.tsx:80`：原生非 passive `touchmove` 说明
- `src/frontend/src/components/SwipePager.tsx:213-241`：触摸监听、邻页挂载、`UNSAFE_LocationContext`
- `src/frontend/src/utils/swipeNavigation.ts`：方向/步进/路由匹配纯函数
- `src/frontend/src/app-shell.css:188-207`：`.swipe-viewport` / `.swipe-track` / `.swipe-page` / `.swipe-page-neighbor`

### 版本

- `src/android-shell/app/build.gradle.kts:16-17`：`versionCode = 2026111102`、`versionName = "2026.11.11.2"`

### 临时预览文件（未跟踪，提交/打包前删除）

- `src/frontend/public/__preview.html`：静态实拍预览页 + 打开手机窗口按钮
- `src/frontend/public/__preview-data.json`：11 门样例课数据
- `src/frontend/public/__seed.html`：把样例数据写入 IndexedDB 后跳转课表
- `src/frontend/public/__shot-390-top.png`、`__shot-390-bottom.png`
- `src/frontend/public/__shot-360-top.png`、`__shot-360-bottom.png`

## 4. 实测数据

### 课表布局

| 项目 | 390×844 | 360×640 |
|---|---|---|
| 课程数 | 11 | 11 |
| 节次行数 | 12 | 12 |
| 单节行高 | 64px | 64px |
| 两节连堂块高 | 128px | 128px |
| 主内容可视高 / 总高 | 716 / 1002 | 512 / 1046 |
| 横向溢出 | 无 | 无 |

### 启动

- 1 秒：加载页
- 3 秒：课表可交互
- 数据库：`tangent-timetable-local-v1` v2
- 控制台异常：0

### 自动化验证

- `npm run typecheck`：通过
- `npm run lint`：0 error（7 个既有 warning）
- `npm run test:timetable-layout`：10 pass / 0 fail
- `npm run test:swipe`：4 pass / 0 fail
- `npm run test:local-core`：25 pass / 0 fail
- Android 外壳单元测试：5 pass / 0 fail
- Windows 外壳策略检查：31 项通过
- Windows 两次隔离启动冒烟：通过，日任务跨启动保留
- Android APK：版本 `2026.11.11.2` / `2026111102`，v2 签名，证书 SHA256 `74e5fa65…ccd332`
- APK 内嵌 `assets/www/index.html` 与 `dist-shell/index.html` 一致（`16ca001b…0fe7`）

## 5. 发行产物

### Android / Windows

目录：`releases/native/kexu-2026.11.11.2/`

| 文件 | 大小 | SHA256 |
|---|---|---|
| `Kexu-Android-2026.11.11.apk` | 3,061,453 | `f8d88e5227e166bf871b87fd3592d9c9b56fd610c66a5a24e8704481463866ed` |
| `Kexu-Windows-x64.zip` | 1,404,245 | `8fb6e72ecc358e61ca18c516a548ae4d9a1b766c288233e5239730ed6f97004a` |
| `Kexu-Windows-x64/Kexu.exe`（压缩包内） | 50,688 | `a654c818e41bcde30082ae874d78f9c9aab49e3b8e5086d77b946d6a71e23faf` |

- `releases/native/kexu-2026.11.11.2/RELEASE_MANIFEST.json`
- `releases/native/kexu-2026.11.11.2/SHA256SUMS.txt`
- `releases/native/kexu-2026.11.11.2/README.md`

### PWA

目录：`releases/mobile/kexu-2026.11.11.2-brand/`

| 文件 | 大小 | SHA256 |
|---|---|---|
| `Kexu-2026.11.11.2-preview.1.zip` | 1,158,729 | `3d2e3f4e7d253b351659b412c14ca86023906e129cde830d1e0f4d9b44e6c193` |

- 包内 50 个文件，解压后 3,761,182 字节，ZIP 52 个条目
- `RELEASE_MANIFEST.json`、`SHA256SUMS.txt`、`README.md` 同目录

### 本地预览

- 预览页：`http://127.0.0.1:5190/__preview.html`
- 课表直开：`http://127.0.0.1:5190/timetable`
- 启动开发服务：

  ```powershell
  cd src/frontend
  $env:VITE_LOCAL_DATA='true'
  npm run dev -- --host 127.0.0.1 --port 5190 --strictPort
  ```

- 实拍原图：
  - `work/edge-shot/timetable-390-top.png`
  - `work/edge-shot/timetable-390-bottom.png`
  - `work/edge-shot/timetable-360-top.png`
  - `work/edge-shot/timetable-360-bottom.png`

## 6. 相关提交

- `3bad2f9`：用圆圈 + 文案替换旧启动页
- `c0c30cc`：手机端左右滑动翻页
- `2f76d62`：手机课表行高加长，恢复地点和时间
- `275c1fa`：加载页横排文字 + 本地数据库打开超时
- `2745986`：版本提升到 `2026.11.11.2`

## 7. 未验证与风险

1. 未做 Android 真机安装、覆盖升级与文件窗口验收；`deviceTested=false`。
2. 没有直接读取用户 Edge 配置的站点数据；独立 Edge 配置下加载正常，用户旧配置超过 10 秒属于该配置的存储问题。
3. PWA 的 Service Worker 可能继续使用旧缓存，需要关闭所有页面后重开两次或清站点数据。
4. 预览页与样例数据是临时文件，未提交；下一次构建前必须删除，否则会被复制进 `dist`。
5. 开发服务器停止后预览地址不可用；静态图片仍可单独打开。
6. `2026.11.11.2` 仅本地生成，未发布；线上 Release 仍为 `v2026.11.01.1`。

## 8. 清理清单

提交或打包前：

```powershell
Remove-Item src/frontend/public/__preview.html,
  src/frontend/public/__preview-data.json,
  src/frontend/public/__seed.html,
  src/frontend/public/__shot-390-top.png,
  src/frontend/public/__shot-390-bottom.png,
  src/frontend/public/__shot-360-top.png,
  src/frontend/public/__shot-360-bottom.png -Force
```

中间的诊断脚本和截图在 `work/`，已被忽略，可随时清理：

- `work/cdp-shot.mjs`、`work/cdp-diag.mjs`、`work/cdp-diag-headed.mjs`
- `work/edge-shot/`
- `work/preview-tmp/`
- `work/release-2026.11.11.2/`
