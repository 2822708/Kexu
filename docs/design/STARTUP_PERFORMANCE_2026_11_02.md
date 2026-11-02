# 启动前摇优化（2026-11-02）

## 现象

Android 端冷启动到看到内容有数秒等待，期间只有系统背景色或空白，随后出现“正在打开本机数据”的加载态。

## 定位（代码证据）

1. **本地数据在启动链路上被反复整读**
   - `readLocalState()` 与 `mutateLocalState()` 每次都会先调用 `initializeLocalStore()`（`src/frontend/src/local/db.ts`）。
   - 初始化本身是一次 readwrite 事务：读取整份 `LocalState`、校验、`structuredClone`。
   - 启动过程依次是 `initializeLocalStore()` → `runLocalMaintenance()`（内部又是 mutate）→ `load()`（内部又是 initialize + get），同一份数据被完整读取 3~5 次。
2. **维护任务挡在首屏前**
   - `LocalAppProvider.reconnect()` 里 `await runLocalMaintenance()` 在 `load()` 之前，`ready` 要等维护完成才置位。
3. **首屏没有任何骨架**
   - `index.html` 的 `#root` 为空，浏览器/WebView 必须等 antd 与业务 chunk 下载、解析、执行后才绘制第一帧。

## 改动

| 改动 | 文件 | 效果 |
|---|---|---|
| 初始化按页面缓存 | `local/db.ts` | 同一页面只做一次整读+校验，后续调用复用 Promise；`closeLocalStore` 与 `onversionchange` 会重置缓存 |
| 维护任务移出关键路径 | `store/LocalAppProvider.tsx` | 先 `load()` 出首屏，再后台执行 `runLocalMaintenance()`；有变更时通过既有 `notify()` 订阅自动刷新 |
| 首屏骨架 + 主题预应用 | `index.html` | HTML 解析后立刻显示品牌与进度条；内联脚本在样式与脚本前设置 `data-theme`，消除深色用户的白闪 |
| 启动打点 | `store/LocalAppProvider.tsx` | 写入 `kexu:init:start` / `init:done` / `first-load:done` / `maintenance:done`，可用 `performance.getEntriesByType('mark')` 在真机 `chrome://inspect` 查看 |

维护任务仍是每次启动执行、语义不变，只是不再阻塞首屏；它写入数据时会触发现有订阅刷新。

## 实测（桌面，空数据集，`dist-shell` 静态服务）

| 指标 | 数值 |
|---|---|
| 首屏内容出现 | 422 ms（热缓存）／604 ms（冷缓存） |
| 本地初始化 | 5–13 ms |
| 维护完成 | 首屏后约 105 ms |

数据量越大，被消除的“整读 + 校验 + clone”次数收益越明显（启动链路从 3~5 次降为 1 次）。

## 仍未解决

- **JS 解析仍然是主要成本**：antd 单 chunk 约 372 KB gzip / 1.2 MB min，桌面约 300–500 ms，Android 低端机通常是 1–3 秒。本次没有动它。
- 未在真机测量；数字来自桌面浏览器，只能证明相对改善。
- PDF / Word 相关 chunk 已经是按需加载（`importFiles.ts` 动态 `import()`），不在首屏关键路径。

## 可选的下一步

1. 真机用 `chrome://inspect` 读取上述 mark，得到 Android 上的阶段耗时。
2. 缩减首屏 antd 体积（按组件导入、或用轻量组件替换卡片/按钮等高频基础件）。
3. 把壳启动页改为 Android SplashScreen API，让冷启动的系统白屏也有品牌承载。
4. 起始路由从 `/focus`（会重定向到 `/tasks`）直接改为 `/tasks`，省一次重定向渲染。
