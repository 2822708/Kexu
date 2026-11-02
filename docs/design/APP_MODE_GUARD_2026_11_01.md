# 运行时模式收敛与启动护栏（2026-11-01）

## 问题

开发时直接运行 `npm run dev`，前端默认走“服务器模式”，把 `/api` 代理到 `http://localhost:8080`。后端未启动时，界面落在“设备连接 / 暂时无法连接”，只显示 `请求失败 (HTTP 500)`，看不出是模式选错还是后端没起。

根因不是单点缺陷，而是结构性的：

- 运行模式由 `import.meta.env.MODE` 与 `VITE_LOCAL_DATA` 在各文件自行拼接；
- `LOCAL_MODE` 布尔值被 18 个文件各自分支，没有一个地方声明“这次运行需要后端”；
- 连接失败的错误信息不含请求地址与修复步骤；
- 没有构建期或启动期断言。

## 改动

1. **单一判定入口** `src/frontend/src/app-mode.ts`：`resolveAppMode()` 是纯函数，返回 `{ id, source, label, needsBackend, hint }`；`src/frontend/src/local/mode.ts` 只负责注入 Vite 环境，`LOCAL_MODE` / `NATIVE_SHELL` 保持原语义，业务文件无需改动。
2. **构建期断言** `assertBuildMode()`，两个方向都拦：
   - 服务器模式的产物若把 `VITE_API_BASE` 指向 `localhost` / `127.0.0.1`，构建失败；
   - 普通网页构建若带 `VITE_LOCAL_DATA=true`，也会失败，避免“部署包其实是本地模式”这种更难排查的错配。需要本地网页产物时用新增的 `npm run build:localdata`，PWA 仍用 `build:mobile`。
3. **启动日志**：开发模式启动时打印 `[kexu] 本地模式（local-mode）：数据保存在本机 IndexedDB，不访问后端。`
4. **失败可执行**：`src/frontend/src/api/connectionDiagnostics.ts` 把连接错误扩展为“请求地址 / 原因 / 三条修复命令”，设备连接页按换行渲染。
5. **脚本语义对齐产品定位**：`npm run dev` 与 `dev:local` 使用 `--mode localdata`（Vite 不允许 `local` 作为 mode 名）；连后端改为显式 `npm run dev:server`。
6. **回归测试**：`scripts/test-app-mode.mjs` 覆盖外壳/PWA/本地标记/默认四种来源、大小写标记与两个方向的构建断言；已加入 CI 的回归命令列表。
7. **消除最后一处重复判定**：`components/PwaStatus.tsx` 不再直接读 `import.meta.env.MODE === 'mobile'`，改为 `APP_MODE.source === 'mobile'`，Service Worker 注册条件同样只认单一入口。

## 验证

- `npm run test:mode`：5/5 通过。
- `npm run typecheck`、`npx eslint`（0 error）通过；`npm run build`、`npm run build:localdata`、`npm run build:mobile` 均通过。
- 实测 `npm run dev`：控制台输出本地模式说明，直接进入课表，不出现设备连接页。
- 实测 `npm run dev:server`（后端未启动）：页面显示请求地址 `/api`、失败原因，以及“启动后端 / 改用 dev:local / 设置 VITE_API_BASE”三条步骤。
- 实测反向断言：带 `VITE_LOCAL_DATA=true` 执行 `npm run build` 被拒绝，并提示改用 `build:localdata` 或 `build:mobile`。

## 边界

- 只收敛了“模式判定与错误提示”，没有把 `LOCAL_MODE` 分支重构成数据源适配器。后续若继续新增接口，建议按 `DataSource` 抽象推进（见讨论中的 Tier 2）。
- 自动从服务器模式回落到本地存储被明确禁止：两者是不同的数据空间，自动切换会造成数据看似丢失。
