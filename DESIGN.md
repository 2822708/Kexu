---
name: Kexu
description: 面向大学生的本地优先课表、任务与 AI 助手界面
colors:
  harbor-teal: "#167d9a"
  harbor-teal-deep: "#106b85"
  harbor-teal-soft: "#e7f4f7"
  lecture-green: "#0c7c72"
  lecture-green-soft: "#e8f5f0"
  mint-accent: "#69c9b3"
  paper: "#f5f8fa"
  surface: "#ffffff"
  ink: "#173244"
  ink-secondary: "#536b78"
  ink-muted: "#647b87"
  line: "#c7d6df"
  line-soft: "#dde6eb"
  alert-red: "#b42318"
  alert-red-soft: "#fef3f2"
  alert-amber: "#8a4b00"
  alert-amber-soft: "#fff4e5"
  topbar-band: "#173244"
typography:
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  title:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.35
  label:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.harbor-teal}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    height: "38px"
    padding: "0 16px"
  button-primary-hover:
    backgroundColor: "{colors.harbor-teal-deep}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 16px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "38px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "16px"
  nav-item-active:
    backgroundColor: "{colors.harbor-teal-soft}"
    textColor: "{colors.harbor-teal-deep}"
    rounded: "{rounded.md}"
  chip-filter:
    backgroundColor: "{colors.harbor-teal-soft}"
    textColor: "{colors.harbor-teal-deep}"
    rounded: "{rounded.pill}"
---

# Design System: Kexu

## Overview

**Creative North Star: "The Day's Arc"**

Kexu 的界面围绕"一天怎么推进"组织，而不是围绕功能模块。顶部常驻的深色横条给出当前位置与周次，主区域按时间顺序展开今天的课、今天要做的事和下一件要处理的事；用户在这里的每一次点击，都应该是把一天往前推一格。

系统的气质是**安静的推进感**：低饱和的青绿作为唯一的强调色，靠边框、留白和字号层级组织信息，而不是靠阴影或装饰。课表格子、任务条目、AI 提案都使用同一套卡片语言，差别在密度而不在样式，这样用户在页面之间移动时不需要重新适应。

**Key Characteristics:**
- 扁平优先：静态表面没有阴影，层级由 1px 边框与背景差完成。
- 单一强调色：青绿系承担选中、主操作与进度，其他颜色只表达状态。
- 时间是一等公民：周次、节次、截止时间、日期在视觉上始终可扫读。
- 密度可调、层级不变：手机到桌面只改变列数与留白，不改变信息顺序。

**未实施的方向（本轮只记录，不改代码）：** 用户希望后续整体更"轻软"——更大的圆角、更柔和的表面感；同时明确表示不喜欢蓝色倾向，主色的替换属于后续设计决策，不应在现有实现中继续强化蓝色的品牌含义。

## Colors

低饱和青绿 + 近白纸面 + 深墨蓝文字；颜色承担角色，不承担装饰。

### Primary
- **Harbor Teal** (`{colors.harbor-teal}`)：主操作按钮、选中态边框、当前导航项、重点数字。只出现在需要注意力的位置。
- **Harbor Teal Deep** (`{colors.harbor-teal-deep}`)：主色的悬停与按下态，以及浅底上的文字色。
- **Harbor Teal Soft** (`{colors.harbor-teal-soft}`)：选中行、标签、当前导航项的底色；不用于大面积背景。

### Secondary
- **Lecture Green** (`{colors.lecture-green}`)：成功、完成、已保存。与主色同族但更绿，用于区分"做完了"和"正在做"。
- **Mint Accent** (`{colors.mint-accent}`)：进度条、完成反馈等短暂出现的强调。

### Neutral
- **Paper** (`{colors.paper}`)：页面底色，浅色主题的全局背景。
- **Surface** (`{colors.surface}`)：卡片、输入框、弹层表面。
- **Ink** (`{colors.ink}`)：正文与标题。
- **Ink Secondary** (`{colors.ink-secondary}`)：次要说明、表头、时间。
- **Ink Muted** (`{colors.ink-muted}`)：占位符、禁用、辅助标签。
- **Line** (`{colors.line}`)：输入框与可交互元素的边框。
- **Line Soft** (`{colors.line-soft}`)：卡片分隔与表格行线。
- **Topbar Band** (`{colors.topbar-band}`)：顶部常驻横条，浅色主题下唯一的深色块。

### 状态色
- **Alert Red** (`{colors.alert-red}`) 与 **Alert Amber** (`{colors.alert-amber}`)：仅用于错误、警告及其浅底。

### Named Rules
**The Single Accent Rule.** 一屏之内，青绿只出现在当前选中项、主操作和需要立刻注意的数字上；其余地方用墨色与线色表达层级。

### 主题色可调
强调色是用户偏好，不是固定品牌色：设置页提供预设（默认青蓝、松针绿、苔绿、陶土、赭石、梅紫、石墨青）与自定义色相。实现只重映射 `--accent`、`--accent-hover`、`--accent-soft`、`--focus-ring` 与 Ant Design 的 `colorPrimary`；饱和度与明度由代码按对比度下限推导（浅色主题白字 ≥ 4.5:1，深色主题 ≥ 4.5:1）。新组件必须使用这几组变量，不得硬编码主色。

## Typography

**Body Font:** system-ui（含 PingFang SC / Microsoft YaHei）
**Label Font:** 同 Body，字重与字号区分层级

**Character:** 不带个性的系统字体，换取跨 Windows / Android / macOS 的一致渲染。中文优先使用系统黑体，数字保持默认比例宽度；字号集中在 11–16px，靠字重和颜色而不是字号跳跃来分层。

### Hierarchy
- **Title** (600, 18px, 1.35)：页面标题、弹窗标题、日课表日期。
- **Body** (400, 14px, 1.6)：正文、任务标题、课程名。
- **Label** (500, 12px, 1.4)：表头、时间、标签、按钮内文字。
- **Micro** (500, 11px)：周次、节次刻度、角标；不用于需要阅读的句子。

### Named Rules
**The 14px Base Rule.** 正文固定 14px，放大只发生在标题层级；不靠整体字号放大解决可读性，优先提高对比度与行距。

## Layout

固定顶部横条（64px）+ 左侧导航 + 主内容区；移动端收起为汉堡菜单与底部导航。内容区最大宽度约 1200px，页面内边距 24px，移动端 16px。间距使用 4 / 8 / 16 / 24 的节奏，卡片内部统一 16px。

断点：1100px（侧栏收窄）、1024px（多列降列）、900px（课表切换）、767px（侧栏抽屉化）、640px（单列）、359px（超窄屏保护）。

周课表的列数决定密度：桌面显示 7 天，窄屏切换为按天分页而不是压缩列宽。任务与提案列表保持单列，不因屏幕变宽而多列铺开。

## Elevation & Depth

系统默认是**平的**：`--surface-shadow` 为 `none`，卡片、面板、课表格子都靠 1px 边线与背景差区分。唯一的阴影用于真正浮起的层（弹窗、下拉、抽屉），值约为 `0 8px 28px` 的柔和投影；深色主题下同位置使用更深的黑色投影。

### Named Rules
**The Flat-By-Default Rule.** 静态表面不加阴影；只有在覆盖页面内容、需要用户先处理它时，才允许出现投影。

## Shapes

圆角以 8px 为默认（按钮、输入框、导航项），12px 用于卡片与容器，4px 用于紧凑标签与表格内元素，999px 用于筛选标签与头像。边线统一 1px，不使用双线或粗描边。没有斜切、装饰角或拟物轮廓。

## Components

### Buttons
- **Shape:** 8px 圆角，高度 38px，左右内边距 16px。
- **Primary:** 青绿实底 + 白字；悬停转为深一档的青绿。
- **Ghost / Secondary:** 白底 + 线色边框 + 墨色文字；悬停只加深边框与文字，不填充。
- **Focus:** 2px 主色描边，不改变尺寸。

### Inputs
- **Style:** 38px 高、白底、1px 线色边框、8px 圆角；占位符用 Ink Muted。
- **Focus:** 边框转为主色并附带 2px 柔和外圈。
- **Error:** 红色边框 + 红色辅助文案，错误文案紧贴字段下方。

### Cards / Containers
- **Corner:** 12px。
- **Background:** 白面。
- **Border:** 1px 线色软边，无阴影。
- **Padding:** 16px；列表型卡片只保留上下 12px。

### Navigation
- **Desktop:** 左侧竖向导航，当前项为青绿浅底 + 深青文字 + 左侧 3px 主色条。
- **Mobile:** 顶部汉堡 + 底部主导航，图标 20px，文字 11px。
- **Topbar:** 深墨蓝横条，品牌名与当前页面名并排，右侧放周次与主题切换。

### Chips / Tags
- **Style:** 999px 胶囊，浅青底 + 深青字；筛选态与选中态同色系，不引入第二种强调色。
- **Density:** 高度 24–28px，字号 12px。

### Timetable Grid（签名组件）
周课表是整个产品的视觉锚点：列是星期，行是节次，课程块用同一张卡片语言，边框区分时段，课程名 13–14px，地点 11px。空档保持留白，不画占位虚线；今天所在列用极浅的青绿底提示，不加边框高亮。

## Do's and Don'ts

### Do:
- **Do** 用 1px 线色边框和背景差建立层级，让页面在无阴影情况下依然清楚。
- **Do** 让青绿只承担"当前/主要/需要立刻注意"三类含义。
- **Do** 保持 14px 正文字号与 12px 标签字号，用字重和颜色区分层级。
- **Do** 在移动端维持单列信息顺序，先时间后内容。
- **Do** 为每一类状态（空、加载、失败、未配置）给出明确文案。

### Don't:
- **Don't** 给静态卡片加投影，或用投影代替分组。
- **Don't** 引入渐变、玻璃拟态或装饰性插画来增加"设计感"。
- **Don't** 在同一个视图里同时使用青绿与另一种高饱和强调色。
- **Don't** 继续把蓝色当作品牌识别色扩展；主色的替换属于后续决策。
- **Don't** 用卡片套卡片的方式表达层级，优先拆分区块。
