# 当前问题清单

代码基线：`32de25c`。整理日期：2026-09-26。

本清单来自本轮源码静态核对和历史审查对照。尚未修复这些业务问题；并发、断连、浏览器时序等场景未在本轮动态复现。编号为本清单内部编号，不直接等同历史 C1–C29。

## 优先级一：数据正确性和业务联动

| 编号 | 问题 | 影响与定位 |
|---|---|---|
| I01 | AI 提案执行没有原子占位 | 同一 PENDING 提案可能被并发执行两次。`src/backend/src/main/java/com/timetable/service/impl/AiServiceImpl.java` 的 executeAction。 |
| I02 | AI 实体修改未完整核对会话课表 | 同账号下另一课表的目标 ID 可能通过所有权校验；需区分账号隔离和课表工作空间边界。AiServiceImpl.applyAction。 |
| I03 | 提案失效和指纹刷新范围不严谨 | 失效按账号和 scope，未完整按课表隔离；后生成提案不等于已看到执行后的数据。invalidatePending / invalidateOtherScopePending。 |
| I04 | 非法提案先入库再报错 | 未支持类型和不完整数据可成为 PENDING 卡片，还可能作废合法旧提案。persistAssistantResult。 |
| I05 | 删除课表遗漏考试待办和会话引用清理 | ScheduleServiceImpl.delete 仅删除课表；exam 级联删除，而 todo.exam_id 和 ai_conversation.schedule_id 没有对应外键清理。 |
| I06 | AI 完成循环待办遗漏下一期生成 | AI TOGGLE_TODO 仅调用 todoService.toggleComplete；手动 TodoController 另调 onTodoCompleted。手动路径的两步也没有统一事务。 |

## 优先级二：交互与运行稳定性

| 编号 | 问题 | 影响与定位 |
|---|---|---|
| I07 | 切换课表后旧请求可能覆盖当前状态 | `src/frontend/src/store/AppContext.tsx` 的 refreshCourses / refreshExams 在 await 后未重新核对当前课表。 |
| I08 | AI 成功后刷新集合不完整 | `src/frontend/src/pages/AiChatPage.tsx` 仅立即刷新课程和待办，考试/循环规则等待后续刷新。 |
| I09 | AI 断连为协作取消，阻塞读取不能立即停止 | DeepSeekClientImpl 在 readLine 返回后检查取消标志；前端未实际接入 AbortController；持久化前缺少最后取消检查。 |
| I10 | 模型截断与流式错误资源处理不足 | 已有部分内容时未统一处理 finish_reason=length；非成功响应的 InputStream 未统一关闭。 |
| I11 | CUSTOM 规则可能错过分钟或过密生成 | 只评估扫描时刻、缺少时间区间补扫；持续为真的条件可逐分钟生成。ISO 日历周也不等于教学周。 |
| I12 | 数据和提示词规模缺少预算 | 多处全量列表、历史和上下文缺少分页/限额，长期数据积累后可能变慢或超出模型容量。 |

## 配置、架构与验证

- 首启账号 label 为“管理员”，默认 ADMIN_LABELS 却为 Tangent0712，默认权限不匹配。
- 数据库没有完整版本化迁移机制，CREATE TABLE IF NOT EXISTS 不会给已有表补列或索引。
- 课程周次、数组长度和部分字符串长度缺少约束。
- Rhino 仍在业务 JVM 内运行，现有防护不等同独立进程强制终止。
- 原部署文档的 Nginx 示例缺少 SSE 缓冲/读取超时专门配置，实际部署效果需验证。
- 自动测试仅有循环时间计算和脚本沙箱两类；现存 21 个通过记录属于前次构建。
- 原项目部分文档仍含旧路径、旧鉴权描述、Node 18 环境要求等偏差。

## 修复时的证据要求

每项更新记录应包含具体触发条件、最终代码变更和对应验证结果。没有新的运行证据时继续标为“静态确认/待复现”；不要从一次构建通过推导业务问题已解决。历史审查正文保留修复前状态，不要直接按其全部问题数计算当前缺陷数。
