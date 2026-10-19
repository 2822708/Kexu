package com.timetable.service.impl;

import com.timetable.dto.AiContextSummary;
import com.timetable.entity.Course;
import com.timetable.entity.Exam;
import com.timetable.entity.Memory;
import com.timetable.entity.PeriodConfig;
import com.timetable.entity.RecurringTodo;
import com.timetable.entity.Schedule;
import com.timetable.entity.StudentProfile;
import com.timetable.entity.Task;
import com.timetable.entity.Todo;
import com.timetable.entity.AiMessage;
import com.timetable.service.LlmClient;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.List;

/**
 * 构建 DeepSeek 的 System Prompt，注入当前日期、学期周次映射、已有课程/待办上下文。
 *
 * AI Campus Agent V1.0 Step 3 起，聊天上下文扩展为五段式：
 * 【学生档案】（全量）/【近期课表】（当前课表数据段）/【当前任务】（未完成、14 天内或已逾期、
 * 最多 15 条）/【长期记忆】（ACTIVE 按重要度 top 20）/【用户问题】（user 消息，永不截断）。
 * 超限的段整体保留并标注「仅提供前 N 条」，与既有数据段风格一致。
 */
public final class AiPromptBuilder {

    private static final int MAX_COURSES = 100;
    private static final int MAX_EXAMS = 100;
    private static final int MAX_TODOS = 100;
    private static final int MAX_RECURRING_RULES = 50;
    public static final int MAX_SYSTEM_PROMPT_CHARS = 40000;
    private static final int MAX_SECTION_CHARS = 7000;
    private static final int MAX_SCRIPT_CHARS = 2000;
    /** 【当前任务】段预算：未完成且 14 天内/已逾期/无截止，最多 15 条。 */
    public static final int MAX_TASKS = 15;
    /** 【长期记忆】段预算：ACTIVE 按重要度排序，最多 20 条。 */
    public static final int MAX_MEMORIES = 20;

    private static final String[] WEEK_NAMES = {"周一", "周二", "周三", "周四", "周五", "周六", "周日"};
    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd");
    private static final DateTimeFormatter DATETIME_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

    private AiPromptBuilder() {}

    public static String weekDayName(int dayOfWeek) {
        if (dayOfWeek < 1 || dayOfWeek > 7) {
            return "未知";
        }
        return WEEK_NAMES[dayOfWeek - 1];
    }

    /**
     * 根据学期开始日期计算某个日期所属的教学周（从 1 开始），学期开始日期所在的那一周为第 1 周。
     */
    public static int weekOf(LocalDate semesterStart, LocalDate date) {
        LocalDate firstMonday = semesterStart.with(DayOfWeek.MONDAY);
        long days = ChronoUnit.DAYS.between(firstMonday, date);
        return (int) Math.floorDiv(days, 7) + 1;
    }

    /**
     * 构建聊天 System Prompt：学长人格（persona 模板）+ JSON 提案协议 + 五段式数据上下文。
     *
     * @param persona 人格段文本（来自 prompts/persona.md，按版本管理）；为空时跳过人格段，
     *                协议与数据上下文仍然完整，聊天不中断
     * @param profile  学生档案（可空）；为空表示尚未建档
     * @param tasks    未完成任务（可空）；调用方已按预算筛选，这里再做上限保护
     * @param memories 长期记忆（可空）；按重要度排序后取 top 20
     * @return prompt 文本 + 实际注入的上下文摘要（供前端 chips 展示）
     */
    public static ChatPrompt buildChatSystemPrompt(Schedule schedule,
                                               List<Course> courses,
                                               List<Exam> exams,
                                               List<Todo> todos,
                                               List<RecurringTodo> recurringTodos,
                                               List<PeriodConfig> periods,
                                               LocalDate today,
                                               String persona,
                                               StudentProfile profile,
                                               List<Task> tasks,
                                               List<Memory> memories) {
        int courseCount = courses == null ? 0 : courses.size();
        int examCount = exams == null ? 0 : exams.size();
        int todoCount = todos == null ? 0 : todos.size();
        int recurringCount = recurringTodos == null ? 0 : recurringTodos.size();
        int taskTotal = tasks == null ? 0 : tasks.size();
        int memoryTotal = memories == null ? 0 : memories.size();
        courses = bounded(courses, MAX_COURSES);
        exams = bounded(exams, MAX_EXAMS);
        todos = bounded(todos, MAX_TODOS);
        recurringTodos = bounded(recurringTodos, MAX_RECURRING_RULES);
        periods = bounded(periods, 12);
        tasks = bounded(tasks, MAX_TASKS);
        memories = bounded(memories, MAX_MEMORIES);
        StringBuilder sb = new StringBuilder();
        if (persona != null && !persona.isBlank()) {
            sb.append("## 你是谁\n").append(persona.strip()).append("\n\n");
        }
        sb.append("你是一个大学生课程表与待办事项管理助手。你需要理解用户的自然语言指令，")
                .append("并输出严格的 JSON（不要包含 markdown 代码块），结构如下：\n")
                .append("{\n")
                .append("  \"text\": \"给用户看的自然语言回复\",\n")
                .append("  \"actions\": [ { \"type\": \"...\", \"data\": { ... } } ]\n")
                .append("}\n\n")
                .append("重要：actions 是数组，一次可以返回多个操作。若用户一句话包含多件事")
                .append("（例如「删掉周五的高数，再加一条周三交实验报告的待办」），")
                .append("请拆成多个独立的 action 元素，每个 action 只做一件事。\n")
                .append("**禁止合并多条记录到一个 action**：删除/修改多条记录时，必须为每条记录")
                .append("单独生成一个 action（如删除 7 门课就生成 7 个 DELETE_COURSE，每个只含一个 id）。\n")
                .append("不需要执行任何操作时，actions 返回空数组 []。\n")
                .append("注意：text 字段必须放在 JSON 的最前面，先写完 text 再写 actions。\n\n");

        sb.append("## action.type 允许的取值及 data 结构\n")
                .append("- CREATE_COURSE: {\"courses\":[{\"name\":\"课程名\",\"location\":\"地点或null\",\"teacher\":\"教师或null\",\"dayOfWeek\":1-7,\"startPeriod\":1-12,\"endPeriod\":1-12,\"weeks\":[周次数组]}]}\n")
                .append("- UPDATE_COURSE: {\"courses\":[{\"id\":课程id,\"name\":...,\"location\":...,\"teacher\":...,\"dayOfWeek\":...,\"startPeriod\":...,\"endPeriod\":...,\"weeks\":[...]}]} （必须携带完整字段，未修改的字段沿用原值）\n")
                .append("- DELETE_COURSE: {\"courseIds\":[课程id数组]}\n")
                .append("- CREATE_TODO: {\"todos\":[{\"title\":\"标题\",\"ddl\":\"yyyy-MM-dd HH:mm\"}]}\n")
                .append("- UPDATE_TODO: {\"todos\":[{\"id\":待办id,\"title\":\"标题\",\"ddl\":\"yyyy-MM-dd HH:mm\"}]}\n")
                .append("- DELETE_TODO: {\"todoIds\":[待办id数组]}\n")
                .append("- TOGGLE_TODO: {\"todoIds\":[待办id数组]}\n")
                .append("- CREATE_TASK: {\"tasks\":[{\"title\":\"动宾结构标题\",\"type\":\"COURSE_WORK|LAB_REPORT|ONLINE_COURSE|EXAM|COMPETITION|OTHER\",\"deadline\":\"yyyy-MM-dd HH:mm 或 null\",\"priority\":1|2|3,\"description\":\"补充说明或空字符串\"}]}\n")
                .append("- UPDATE_TASK: {\"tasks\":[{\"id\":任务id,\"title\":\"动宾结构标题\",\"type\":\"...\",\"deadline\":\"yyyy-MM-dd HH:mm 或 null\",\"priority\":1|2|3,\"description\":\"...\",\"status\":\"PENDING|IN_PROGRESS|DONE|CANCELLED\"}]}\n")
                .append("- CREATE_RECURRING: {\"rules\":[{\"title\":\"标题\",\"frequency\":\"DAILY|WEEKLY|MONTHLY|CUSTOM\",")
                .append("\"dayOfWeek\":1-7（WEEKLY 必填）,\"dayOfMonth\":1-31（MONTHLY 必填）,")
                .append("\"triggerTime\":\"HH:mm\"（CUSTOM 不需要）,\"ddlOffsetMinutes\":从触发到截止的分钟数,")
                .append("\"chainAfterComplete\":true/false,\"script\":\"自定义脚本\"（仅 CUSTOM 必填）}]}\n")
                .append("- UPDATE_RECURRING: {\"rules\":[{\"id\":规则id, 其余字段同上（需携带完整字段）}]}\n")
                .append("- DELETE_RECURRING: {\"recurringIds\":[规则id数组]}\n")
                .append("- TOGGLE_RECURRING: {\"recurringIds\":[规则id数组]}（启用/停用切换）\n")
                .append("- CREATE_EXAM: {\"exams\":[{\"name\":\"考试名\",\"location\":\"地点或null\",\"examDate\":\"yyyy-MM-dd\",\"startTime\":\"HH:mm\",\"endTime\":\"HH:mm\"}]}\n")
                .append("- UPDATE_EXAM: {\"exams\":[{\"id\":考试id, 其余字段同 CREATE_EXAM（需携带完整字段）}]}\n")
                .append("- DELETE_EXAM: {\"examIds\":[考试id数组]}\n\n");

        sb.append("## 任务模块说明（与待办相互独立）\n")
                .append("任务（task）与待办（todo）是两个独立模块：todo 是轻量提醒（标题+截止）；")
                .append("任务有类型、优先级、状态与来源，用于作业、实验报告、网课、考试、竞赛等需要跟踪进度的事项。\n")
                .append("- 用户说「任务」「项目」「计划」或需要类型/优先级/状态管理时，用 CREATE_TASK；")
                .append("只是一句提醒（「明天记得带伞」）才用 CREATE_TODO\n")
                .append("- CREATE_TASK 的 deadline 只取明确写出的日期/时间；没有任何明确时间必须填 null，严禁猜测、严禁补全\n")
                .append("- priority：1=高（临近截止、用户强调、学分权重高），2=中（默认），3=低\n")
                .append("- UPDATE_TASK 可携带 status 流转状态：用户说「做完了」「完成了」→ DONE；")
                .append("「先放着」→ PENDING；「不做了」→ CANCELLED。用下面【当前任务】里的真实 id\n")
                .append("- title 用动宾结构，如「提交高等数学第三次作业」\n\n");

        sb.append("## 考试记录说明\n")
                .append("考试记录用于期末周等场景，**不按课时计算时间**，直接指定日期和起止时间，")
                .append("在课表里按日期/时间展示。\n")
                .append("- 考试名直接用考试类型/名称，如\"数据结构期末考试\"、\"CET-6\"、\"业余无线电A类考试\"；")
                .append("不区分是否关联课程，考试只包含名称、日期、起止时间、地点\n")
                .append("- 新增考试必须提供 name、examDate（yyyy-MM-dd）、startTime 与 endTime（HH:mm，结束不能早于开始）；location 可空\n")
                .append("- 修改/删除考试时，用下面\"已有考试\"里的真实考试 id\n")
                .append("- 用户说\"给数据结构加场期末考试\"\"加一场12月16日的CET6\"等，都只需 CREATE_EXAM，考试名写清楚即可\n\n");

        sb.append("## 循环待办说明\n")
                .append("循环待办是一条「规则」，到达触发时间时系统自动生成一条真实待办。\n")
                .append("- 例：「每周五12点提醒我刷本周网课，本周日12点截止」→ CREATE_RECURRING，")
                .append("frequency=WEEKLY, dayOfWeek=5, triggerTime=\"12:00\", ddlOffsetMinutes=2880（周五12点到周日12点=2天）\n")
                .append("- ddlOffsetMinutes 必须自己算清楚：1小时=60，1天=1440，1周=10080\n")
                .append("- chainAfterComplete=true 表示「用户完成当期后立即生成下一期」，")
                .append("默认 false（只按触发时间生成）。用户明确说「做完就接下一个」时才设 true\n")
                .append("- 用户说「取消/停掉每周的某个提醒」时，优先用 TOGGLE_RECURRING 停用而不是 DELETE_RECURRING 删除，")
                .append("除非用户明确说「删除」\n")
                .append("- 区分清楚：「下周五交作业」是一次性待办（CREATE_TODO）；")
                .append("「每周五提醒我」才是循环规则（CREATE_RECURRING）\n\n");

        sb.append("## 自定义循环规则（frequency=CUSTOM）\n")
                .append("固定的每日/每周/每月覆盖不了「双周的周五」「每月最后一个工作日」这类需求，")
                .append("此时用 CUSTOM 并提供一段 JavaScript 脚本，由脚本决定触发时机。\n")
                .append("- 脚本必须定义 function shouldTrigger(ctx) 并返回布尔值（true=此刻触发）\n")
                .append("- 只能用纯 JavaScript，不能访问任何 Java 对象、不能 import、不能调用 IO\n")
                .append("- 不需要 triggerTime（CUSTOM 由脚本自行判断时刻）\n")
                .append("- ctx 可用字段：\n")
                .append("    ctx.year / ctx.month / ctx.day（年月日）\n")
                .append("    ctx.dayOfWeek（1=周一...7=周日）/ ctx.dayOfYear\n")
                .append("    ctx.hour / ctx.minute（时、分）\n")
                .append("    ctx.weekOfYear（ISO 年内周序号，不是学期教学周）\n")
                .append("    ctx.daysInMonth / ctx.isLastDayOfMonth / ctx.isWeekend\n")
                .append("    ctx.daysSinceLastTrigger（距上次触发天数，从未触发为 -1）\n")
                .append("    ctx.neverTriggered（是否从未触发过）\n")
                .append("- 系统按上海时间每分钟检查，延迟时最多补查最近 10 分钟，同一分钟只触发一次\n")
                .append("- 示例「每逢双周的周五 12:00」：\n")
                .append("    frequency=\"CUSTOM\", script=\"function shouldTrigger(ctx){return ctx.dayOfWeek===5 && ctx.hour===12 && ctx.minute===0 && ctx.weekOfYear%2===0;}\"\n")
                .append("- 脚本会保存前试运行校验，语法错误或不返回布尔值会被拒绝入库\n\n");

        sb.append("## 诚实原则（非常重要）\n")
                .append("- 你只能做上面 action.type 列出的操作。用户要求超出这个范围时（例如查天气、")
                .append("发邮件、设置手机提醒、修改作息时间表、创建/删除课表、导出文件等），")
                .append("必须直接、简短地说明你做不到，并告诉用户可以在哪个页面自行操作，actions 返回 []。\n")
                .append("- 指令含义不清楚、或缺少关键信息（如没说星期几、没说第几节）时，")
                .append("不要猜测、不要长时间反复推理，直接用一句话追问缺失的信息，actions 返回 []。\n")
                .append("- 在「已有课程」「已有待办」里找不到用户所指的目标时，直接说明没找到，")
                .append("并列出你认为最接近的几条供用户确认，不要凭空编造 id。\n")
                .append("- 保持回复简短。不要复述完整课表，不要输出冗长的推理过程。\n\n");

        sb.append("## 数据权威性（严禁编造限制）\n")
                .append("- 下面列表是每轮重新查询的当前数据摘要，有条数和字符上限，不保证全量。")
                .append("其中每条记录都带有真实 id，你可以直接使用这些 id 做修改和删除。\n")
                .append("- 严禁声称「未记录 id」「无法获取 id」「不知道 id」「无法撤销」这类不存在的限制。")
                .append("只要目标记录出现在下面的列表里，你就有它的 id，就能操作它。\n")
                .append("- 判断一条记录是否存在，**只看下面的列表**，不要依据历史对话推测。")
                .append("历史里提到过的记录可能已被删除；历史里没提过的记录也可能已存在。\n")
                .append("- 如果列表里没有目标，可能是上下文省略，不可断言已不存在。请用户明确记录或在页面查询。")
                .append("省略的字段或脚本不可猜测；修改 CUSTOM 规则需要完整脚本，否则请用户在循环任务页修改。\n\n");

        sb.append("## 撤销 / 回退操作\n")
                .append("用户说「撤销」「回退」「我操作错了」「恢复」时，按下面的规则处理：\n")
                .append("- 先看历史里已 EXECUTED 的提案，判断需要反向操作哪些内容。\n")
                .append("- 撤销「添加」→ 用 DELETE_* 删除它。该记录现在一定在下面的列表里，用列表中的真实 id。\n")
                .append("- 撤销「删除」→ 用 CREATE_* 按历史提案 data._before 里的原始字段重新创建（id 由系统重新分配，不要自己填 id）。\n")
                .append("- 撤销「修改」→ 用 UPDATE_* 把字段改回 data._before 里的原值，id 用列表中的真实 id。\n")
                .append("- 用户说「撤销所有操作」时，只能对上下文中有完整原始数据的已执行提案生成反向操作，")
                .append("历史不完整时明确说明范围并让用户核对，不要承诺全量回退。\n\n");

        sb.append("## 语义约定\n")
                .append("- \"下周一\" = 下一周的那个周一（只有那一周，weeks 只含一个周次）\n")
                .append("- \"每周一\"/\"每周的周一\" = 全学期所有周\n")
                .append("- \"周三\"（无修饰） = 本学期所有周的周三\n")
                .append("- \"这周六补下周一的课\" = 把周一的课复制到本周六（weeks 只含当前周）\n")
                .append("- 地点、教师等未提供的信息设为 null，并在 text 中提示用户\"待补充\"\n")
                .append("- 修改/删除时必须使用下面\"已有课程\"里的真实 id\n")
                .append("- 严禁编造不存在的 id；若找不到目标，actions 设为 [] 并在 text 中说明\n\n");

        // ---- 稳定前缀到此为止。以下是每次调用都可能变的内容（日期、课表、档案、任务、记忆），
        // ---- 必须排在稳定前缀之后，否则前缀缓存从第一处差异起就全部失配。
        String stablePrefix = sb.toString();
        StringBuilder ctx = new StringBuilder();

        ctx.append("## 当前时间上下文\n");
        ctx.append("今天是 ").append(today.format(DATE_FMT)).append(" ")
                .append(weekDayName(today.getDayOfWeek().getValue())).append("。\n");
        ctx.append("明天是 ").append(today.plusDays(1).format(DATE_FMT)).append(" ")
                .append(weekDayName(today.plusDays(1).getDayOfWeek().getValue())).append("。\n");

        if (schedule != null) {
            int currentWeek = weekOf(schedule.getPeriodStartDate(), today);
            int totalWeeks = weekOf(schedule.getPeriodStartDate(), schedule.getPeriodEndDate());
            ctx.append("当前课表：").append(brief(schedule.getName(), 200))
                    .append("，学期范围 ").append(schedule.getPeriodStartDate().format(DATE_FMT))
                    .append(" ~ ").append(schedule.getPeriodEndDate().format(DATE_FMT))
                    .append("，共 ").append(totalWeeks).append(" 周。\n");
            ctx.append("今天属于第 ").append(currentWeek).append(" 周。\n");
            ctx.append("全学期周次范围：1 ~ ").append(totalWeeks).append("。\n\n");

            sb.append("### 日期-周次对照表（本周及前后两周）\n");
            LocalDate monday = today.with(DayOfWeek.MONDAY).minusWeeks(1);
            for (int w = 0; w < 4; w++) {
                for (int d = 0; d < 7; d++) {
                    LocalDate date = monday.plusWeeks(w).plusDays(d);
                    ctx.append(date.format(DATE_FMT)).append(" 第")
                            .append(weekOf(schedule.getPeriodStartDate(), date)).append("周 ")
                            .append(weekDayName(d + 1));
                    if (date.equals(today)) {
                        ctx.append(" ← 今天");
                    }
                    ctx.append("\n");
                }
            }
            ctx.append("\n");
        } else {
            ctx.append("当前没有选中课表，涉及课程的操作请提示用户先选择课表。\n\n");
        }

        if (periods != null && !periods.isEmpty()) {
            ctx.append("### 作息时间表\n");
            for (PeriodConfig p : periods) {
                ctx.append("第").append(p.getPeriodNumber()).append("节 ")
                        .append(p.getStartTime()).append("-").append(p.getEndTime()).append("\n");
            }
            ctx.append("\n");
        }

        ctx.append("### 已有课程\n");
        int sectionStart = ctx.length();
        if (courses == null || courses.isEmpty()) {
            ctx.append("（无）\n");
        } else {
            if (courseCount > MAX_COURSES) {
                ctx.append("当前仅提供前 ").append(MAX_COURSES).append(" 条，共 ")
                        .append(courseCount).append(" 条。\n");
            }
            for (Course c : courses) {
                StringBuilder record = new StringBuilder("id=").append(c.getId())
                        .append(" 名称=").append(c.getName())
                        .append(" ").append(weekDayName(c.getDayOfWeek()))
                        .append(" 第").append(c.getStartPeriod()).append("-").append(c.getEndPeriod()).append("节")
                        .append(" 周次=").append(c.getWeeks())
                        .append(" 地点=").append(c.getLocation() == null ? "未指定" : c.getLocation())
                        .append(" 教师=").append(c.getTeacher() == null ? "未指定" : c.getTeacher())
                        .append("\n");
                if (!appendContextRecord(ctx, record, sectionStart)) break;
            }
        }
        ctx.append("\n### 已有考试\n");
        sectionStart = ctx.length();
        if (exams == null || exams.isEmpty()) {
            ctx.append("（无）\n");
        } else {
            if (examCount > MAX_EXAMS) {
                ctx.append("当前仅提供前 ").append(MAX_EXAMS).append(" 条，共 ")
                        .append(examCount).append(" 条。\n");
            }
            for (Exam e : exams) {
                StringBuilder record = new StringBuilder("id=").append(e.getId())
                        .append(" 考试名=").append(e.getName())
                        .append(" 日期=").append(e.getExamDate())
                        .append(" 时间=").append(e.getStartTime()).append("-").append(e.getEndTime())
                        .append(" 地点=").append(e.getLocation() == null ? "未指定" : e.getLocation())
                        .append("\n");
                if (!appendContextRecord(ctx, record, sectionStart)) break;
            }
        }

        ctx.append("\n### 已有待办\n");
        sectionStart = ctx.length();
        if (todos == null || todos.isEmpty()) {
            ctx.append("（无）\n");
        } else {
            if (todoCount > MAX_TODOS) {
                ctx.append("当前仅提供前 ").append(MAX_TODOS).append(" 条，共 ")
                        .append(todoCount).append(" 条。\n");
            }
            for (Todo t : todos) {
                StringBuilder record = new StringBuilder("id=").append(t.getId())
                        .append(" 标题=").append(t.getTitle())
                        .append(" 截止=").append(t.getDdl())
                        .append(" 已完成=").append(Boolean.TRUE.equals(t.getCompleted()) ? "是" : "否");
                if (t.getRecurringId() != null) {
                    record.append(" 来源=循环规则").append(t.getRecurringId());
                }
                record.append("\n");
                if (!appendContextRecord(ctx, record, sectionStart)) break;
            }
        }

        ctx.append("\n### 已有循环待办规则\n");
        sectionStart = ctx.length();
        if (recurringTodos == null || recurringTodos.isEmpty()) {
            ctx.append("（无）\n");
        } else {
            if (recurringCount > MAX_RECURRING_RULES) {
                ctx.append("当前仅提供前 ").append(MAX_RECURRING_RULES).append(" 条，共 ")
                        .append(recurringCount).append(" 条。\n");
            }
            for (RecurringTodo r : recurringTodos) {
                StringBuilder record = new StringBuilder("id=").append(r.getId())
                        .append(" 标题=").append(r.getTitle())
                        .append(" 频率=").append(r.getFrequency());
                if (r.getDayOfWeek() != null) {
                    record.append("(").append(weekDayName(r.getDayOfWeek())).append(")");
                }
                if (r.getDayOfMonth() != null) {
                    record.append("(每月").append(r.getDayOfMonth()).append("日)");
                }
                record.append(" 触发时刻=").append(r.getTriggerTime())
                        .append(" 截止偏移=").append(r.getDdlOffsetMinutes()).append("分钟")
                        .append(" 状态=").append(Boolean.TRUE.equals(r.getEnabled()) ? "启用" : "已停用")
                        .append(" 完成后接下一期=").append(Boolean.TRUE.equals(r.getChainAfterComplete()) ? "是" : "否")
                        .append(" 下次触发=").append(r.getNextTriggerAt());
                if (r.getScript() != null && !r.getScript().isBlank()) {
                    record.append(" 脚本=").append(r.getScript().length() <= MAX_SCRIPT_CHARS
                            ? r.getScript() : "[脚本过长已省略，请在循环任务页查看和修改]");
                }
                record.append("\n");
                if (!appendContextRecord(ctx, record, sectionStart)) break;
            }
        }

        // ==================== 五段式上下文新增段（AI Campus Agent V1.0 Step 3） ====================

        ctx.append("\n### 学生档案\n");
        boolean profilePresent = profile != null && hasProfileContent(profile);
        if (!profilePresent) {
            ctx.append("（尚未填写。用户问到个人情况、目标或基础时，先询问或建议到设置页完善，不要假设其信息。）\n");
        } else {
            StringBuilder fields = new StringBuilder();
            appendField(fields, "姓名", profile.getName());
            appendField(fields, "学校", profile.getSchool());
            appendField(fields, "专业", profile.getMajor());
            appendField(fields, "年级", profile.getGrade());
            appendField(fields, "目标", brief(profile.getGoal(), 300));
            appendField(fields, "学习风格", profile.getLearningStyle());
            appendField(fields, "兴趣", joinTags(profile.getInterest()));
            appendField(fields, "技能", joinTags(profile.getSkills()));
            ctx.append(fields.length() == 0 ? "（尚未填写）" : fields.toString().strip()).append('\n');
        }

        ctx.append("\n### 当前任务\n");
        ctx.append("（任务与待办是两个独立模块：待办来自对话指令与循环规则，任务来自文件解析、手动创建或待办迁移；")
                .append("用户说「任务」时指本节，「待办」指上一节。列表含未完成且 14 天内截止、已逾期或未设置截止的任务。）\n");
        sectionStart = ctx.length();
        if (tasks == null || tasks.isEmpty()) {
            ctx.append("（无）\n");
        } else {
            if (taskTotal > MAX_TASKS) {
                ctx.append("当前仅提供前 ").append(MAX_TASKS).append(" 条，共 ").append(taskTotal).append(" 条。\n");
            }
            for (Task task : tasks) {
                StringBuilder record = new StringBuilder("id=").append(task.getId())
                        .append(" 标题=").append(brief(task.getTitle(), 200))
                        .append(" 类型=").append(taskTypeLabel(task.getType()))
                        .append(" 优先级=").append(taskPriorityLabel(task.getPriority()))
                        .append(" 状态=").append(taskStatusLabel(task.getStatus()))
                        .append(" 截止=").append(task.getDeadline() == null
                                ? "未设置" : task.getDeadline().format(DATETIME_FMT));
                if (task.getDescription() != null && !task.getDescription().isBlank()) {
                    record.append(" 描述=").append(brief(task.getDescription(), 300));
                }
                record.append("\n");
                if (!appendContextRecord(ctx, record, sectionStart)) break;
            }
        }

        ctx.append("\n### 长期记忆\n");
        sectionStart = ctx.length();
        if (memories == null || memories.isEmpty()) {
            ctx.append("（暂无）\n");
        } else {
            if (memoryTotal > MAX_MEMORIES) {
                ctx.append("当前仅提供重要度前 ").append(MAX_MEMORIES).append(" 条，共 ")
                        .append(memoryTotal).append(" 条。\n");
            }
            for (Memory memory : memories) {
                StringBuilder record = new StringBuilder("- [")
                        .append(memoryTypeLabel(memory.getType())).append("·重要度")
                        .append(memory.getImportance()).append("] ")
                        .append(brief(memory.getContent(), 200)).append('\n');
                if (!appendContextRecord(ctx, record, sectionStart)) break;
            }
        }

        // 摘要与注入内容同源同算：前端 chips 展示的就是模型这轮真实看到的条数
        AiContextSummary summary = summarizeContext(profile, courseCount, taskTotal, memoryTotal);
        return new ChatPrompt(stablePrefix + ctx, summary, stablePrefix, ctx.toString());
    }

    /**
     * 计算上下文注入摘要（与 {@link #buildChatSystemPrompt} 相同的预算规则），
     * 供 GET /conversations/{id}/context 在发送前预取，让前端 chips 与实际注入一致。
     *
     * @param courseCount 当前课表课程条数（上限 MAX_COURSES）
     * @param taskTotal   未完成窗口内任务总条数（上限 MAX_TASKS）
     * @param memoryTotal ACTIVE 记忆总条数（上限 MAX_MEMORIES）
     */
    public static AiContextSummary summarizeContext(StudentProfile profile, int courseCount,
                                                    int taskTotal, int memoryTotal) {
        AiContextSummary summary = new AiContextSummary();
        summary.setProfilePresent(profile != null && hasProfileContent(profile));
        summary.setCourseCount(Math.min(Math.max(courseCount, 0), MAX_COURSES));
        int injectedTasks = Math.min(Math.max(taskTotal, 0), MAX_TASKS);
        summary.setTaskCount(injectedTasks);
        summary.setTasksTruncated(taskTotal > injectedTasks);
        int injectedMemories = Math.min(Math.max(memoryTotal, 0), MAX_MEMORIES);
        summary.setMemoryCount(injectedMemories);
        summary.setMemoriesTruncated(memoryTotal > injectedMemories);
        return summary;
    }

    /**
     * 聊天 system prompt 与同步算出的上下文摘要（单一数据源，避免 chips 与实际注入不一致）。
     *
     * <p>成本治理 6.1 #4 起拆成两段，见 {@link ChatPrompt#stablePrefix()} 与
     * {@link ChatPrompt#dynamicContext()}。
     */
    public record ChatPrompt(String prompt, AiContextSummary summary,
                             String stablePrefix, String dynamicContext) {

        /**
         * 稳定前缀：人格 + JSON 协议 + 诚实原则等「与本次会话数据无关」的全部内容。
         *
         * <p>同一个用户、同一版 persona 模板下，这段**逐字节相同**，是上游前缀缓存
         * （DeepSeek 上下文缓存 / OpenAI automatic caching）的唯一可命中对象。
         */
        public String stablePrefix() { return stablePrefix == null ? "" : stablePrefix; }

        /** 动态上下文：当前时间、课表、档案、任务、记忆。每次都可能变。 */
        public String dynamicContext() { return dynamicContext == null ? "" : dynamicContext; }
    }

    /**
     * 把聊天主 system prompt 拼成两条消息：稳定前缀 + 动态上下文。
     *
     * <p><b>为什么必须拆两条而不是一条</b>：上游的前缀缓存是「从第一个 token 起逐字节比对」，
     * 一旦不匹配就整段未命中。原实现把「今天是 2026-10-19」塞在 system 中间，
     * 用户第二天再聊天，前缀在日期那一行就断了，后面几千 token 的协议说明全部重新计费。
     * 拆开后稳定前缀每天都不变，动态部分只占尾部。
     *
     * <p>动态段为空时返回单条 system，不塞一条空的 system 进 payload——
     * 空的 system 消息会被某些网关当成非法输入，也会白白占一次 message 计数。
     */
    public static List<LlmClient.Message> chatSystemMessages(ChatPrompt prompt) {
        String stable = prompt.stablePrefix();
        String dynamic = prompt.dynamicContext();
        if (dynamic.isBlank()) {
            return List.of(new LlmClient.Message("system", stable));
        }
        return List.of(new LlmClient.Message("system", stable),
                new LlmClient.Message("system", dynamic));
    }

    /**
     * 每日计划的模型输入（AI Campus Agent V1.0 Step 6）。
     *
     * 只提供真实数据：日期/星期/教学周、作息表、今日课程（已按节次换算成真实起止时刻）、
     * 未完成任务、学生档案。课程时刻由服务端换算而非交给模型推算——校验时据此判定
     * 「课程块是否与课表一致」，保证时间线不会凭空生成上课时间。
     */
    public static String buildDailyPlanInput(LocalDate date, Schedule schedule, List<Course> courses,
                                             List<PeriodConfig> periods, List<Task> tasks,
                                             StudentProfile profile) {
        StringBuilder sb = new StringBuilder();
        sb.append("【日期】").append(date.format(DATE_FMT)).append(' ')
                .append(weekDayName(date.getDayOfWeek().getValue()));
        if (schedule != null) {
            int currentWeek = weekOf(schedule.getPeriodStartDate(), date);
            sb.append("（第 ").append(currentWeek).append(" 周 / 共 ")
                    .append(weekOf(schedule.getPeriodStartDate(), schedule.getPeriodEndDate())).append(" 周）");
        }
        sb.append('\n');
        if (schedule != null) {
            sb.append("【课表】").append(brief(schedule.getName(), 100)).append(' ')
                    .append(schedule.getPeriodStartDate().format(DATE_FMT)).append(" ~ ")
                    .append(schedule.getPeriodEndDate().format(DATE_FMT)).append('\n');
        }

        sb.append("\n【作息表】\n");
        if (periods == null || periods.isEmpty()) {
            sb.append("（未提供，课程时刻见下方今日课程）\n");
        } else {
            for (PeriodConfig p : periods) {
                sb.append("第").append(p.getPeriodNumber()).append("节 ")
                        .append(p.getStartTime()).append("-").append(p.getEndTime()).append('\n');
            }
        }

        sb.append("\n【今日课程】\n");
        if (courses == null || courses.isEmpty()) {
            sb.append("（今天没有课）\n");
        } else {
            for (Course c : courses) {
                sb.append("- id=").append(c.getId()).append(' ').append(brief(c.getName(), 60))
                        .append(' ').append(courseTimeRange(c, periods));
                if (c.getLocation() != null && !c.getLocation().isBlank()) {
                    sb.append(" 地点=").append(c.getLocation());
                }
                if (c.getTeacher() != null && !c.getTeacher().isBlank()) {
                    sb.append(" 教师=").append(c.getTeacher());
                }
                sb.append('\n');
            }
        }

        sb.append("\n【未完成任务】\n");
        if (tasks == null || tasks.isEmpty()) {
            sb.append("（无）\n");
        } else {
            for (Task task : tasks) {
                sb.append("- id=").append(task.getId()).append(' ').append(brief(task.getTitle(), 60))
                        .append(" [").append(taskTypeLabel(task.getType())).append('·')
                        .append(taskPriorityLabel(task.getPriority())).append("优先级]")
                        .append(" 截止=").append(task.getDeadline() == null
                                ? "未设置" : task.getDeadline().format(DATETIME_FMT))
                        .append(" 状态=").append(taskStatusLabel(task.getStatus()));
                if (task.getDescription() != null && !task.getDescription().isBlank()) {
                    sb.append(" 说明=").append(brief(task.getDescription(), 100));
                }
                sb.append('\n');
            }
        }

        sb.append("\n【学生档案】\n");
        if (profile == null || !hasProfileContent(profile)) {
            sb.append("（尚未填写，不需要追问，按普通大学生节奏安排即可）\n");
        } else {
            StringBuilder fields = new StringBuilder();
            appendField(fields, "姓名", profile.getName());
            appendField(fields, "专业", profile.getMajor());
            appendField(fields, "年级", profile.getGrade());
            appendField(fields, "目标", profile.getGoal());
            appendField(fields, "学习风格", profile.getLearningStyle());
            sb.append(fields.length() == 0 ? "（尚未填写）" : fields.toString().strip()).append('\n');
        }
        return sb.toString();
    }

    /** 课程节次 → 起止时刻字符串（如 "08:00-09:40"）；作息表缺失时退回「第X-Y节」。 */
    public static String courseTimeRange(Course course, List<PeriodConfig> periods) {
        return courseTimeRange(course.getStartPeriod(), course.getEndPeriod(), periods);
    }

    /** 起止节次 → 起止时刻字符串；作息表缺任一节次时退回「第X-Y节」。 */
    public static String courseTimeRange(Integer startPeriod, Integer endPeriod,
                                         List<PeriodConfig> periods) {
        LocalTime start = periodStart(periods, startPeriod);
        LocalTime end = periodEnd(periods, endPeriod);
        if (start == null || end == null) {
            return "第" + (startPeriod == null ? "?" : startPeriod) + "-"
                    + (endPeriod == null ? "?" : endPeriod) + "节";
        }
        return start + "-" + end;
    }

    /** 节次 → 开始时刻；作息表未覆盖该节次时返回 null。 */
    public static LocalTime periodStart(List<PeriodConfig> periods, Integer periodNumber) {
        return periodTime(periods, periodNumber, true);
    }

    /** 节次 → 结束时刻；作息表未覆盖该节次时返回 null。 */
    public static LocalTime periodEnd(List<PeriodConfig> periods, Integer periodNumber) {
        return periodTime(periods, periodNumber, false);
    }

    private static LocalTime periodTime(List<PeriodConfig> periods, Integer periodNumber, boolean start) {
        if (periods == null || periodNumber == null) {
            return null;
        }
        for (PeriodConfig p : periods) {
            if (p.getPeriodNumber() != null && p.getPeriodNumber().intValue() == periodNumber.intValue()) {
                return start ? p.getStartTime() : p.getEndTime();
            }
        }
        return null;
    }

    private static boolean hasProfileContent(StudentProfile profile) {
        return notBlank(profile.getName()) || notBlank(profile.getSchool()) || notBlank(profile.getMajor())
                || notBlank(profile.getGrade()) || notBlank(profile.getGoal())
                || notBlank(profile.getLearningStyle())
                || (profile.getInterest() != null && !profile.getInterest().isEmpty())
                || (profile.getSkills() != null && !profile.getSkills().isEmpty());
    }

    private static boolean notBlank(String value) {
        return value != null && !value.isBlank();
    }

    private static String joinTags(List<String> tags) {
        if (tags == null || tags.isEmpty()) {
            return null;
        }
        return String.join("、", tags);
    }

    private static String taskTypeLabel(String type) {
        if (type == null) return "未指定";
        return switch (type) {
            case "COURSE_WORK" -> "课程作业";
            case "LAB_REPORT" -> "实验报告";
            case "ONLINE_COURSE" -> "网课";
            case "EXAM" -> "考试";
            case "COMPETITION" -> "竞赛";
            case "OTHER" -> "其他";
            default -> type;
        };
    }

    private static String taskPriorityLabel(Integer priority) {
        if (priority == null) return "中";
        return switch (priority) {
            case 1 -> "高";
            case 2 -> "中";
            case 3 -> "低";
            default -> "中";
        };
    }

    private static String taskStatusLabel(String status) {
        if (status == null) return "未指定";
        return switch (status) {
            case "PENDING" -> "未开始";
            case "IN_PROGRESS" -> "进行中";
            case "DONE" -> "已完成";
            case "CANCELLED" -> "已取消";
            default -> status;
        };
    }

    private static String memoryTypeLabel(String type) {
        if (type == null) return "未指定";
        return switch (type) {
            case "GOAL" -> "目标";
            case "INTEREST" -> "兴趣";
            case "ABILITY" -> "能力";
            case "HABIT" -> "习惯";
            case "PREFERENCE" -> "偏好";
            default -> type;
        };
    }

    private static boolean appendContextRecord(StringBuilder target, StringBuilder record, int sectionStart) {
        // Omit whole records, preserving the validity of dates, IDs and executable scripts.
        if (target.length() - sectionStart + record.length() > MAX_SECTION_CHARS
                || target.length() + record.length() > MAX_SYSTEM_PROMPT_CHARS - 1000) {
            target.append("（本节其余记录因上下文长度限制已省略，不代表不存在。）\n");
            return false;
        }
        target.append(record);
        return true;
    }

    private static String brief(String value, int limit) {
        if (value == null) return "";
        return value.length() <= limit ? value : value.substring(0, limit) + "[省略]";
    }

    private static <T> List<T> bounded(List<T> values, int limit) {
        if (values == null || values.size() <= limit) {
            return values;
        }
        return values.subList(0, limit);
    }

    /**
     * 记忆提炼的输入窗口：学生档案 + 已有长期记忆 + 最近对话（纯文本）。
     * 与聊天上下文分离：这里只需要「已经聊过什么」，不需要课表/待办全量数据。
     */
    public static String buildMemoryRefineWindow(StudentProfile profile, List<Memory> memories,
                                                 List<AiMessage> window) {
        StringBuilder sb = new StringBuilder();
        sb.append("【学生档案】\n");
        if (profile == null) {
            sb.append("（未填写）\n");
        } else {
            StringBuilder fields = new StringBuilder();
            appendField(fields, "姓名", profile.getName());
            appendField(fields, "学校", profile.getSchool());
            appendField(fields, "专业", profile.getMajor());
            appendField(fields, "年级", profile.getGrade());
            appendField(fields, "目标", profile.getGoal());
            appendField(fields, "学习习惯", profile.getLearningStyle());
            appendField(fields, "兴趣", profile.getInterest() == null || profile.getInterest().isEmpty()
                    ? null : String.join("、", profile.getInterest()));
            appendField(fields, "技能", profile.getSkills() == null || profile.getSkills().isEmpty()
                    ? null : String.join("、", profile.getSkills()));
            sb.append(fields.length() == 0 ? "（未填写）" : fields.toString().strip()).append('\n');
        }

        sb.append("\n【已有长期记忆】\n");
        List<Memory> known = bounded(memories, MAX_MEMORIES);
        if (known == null || known.isEmpty()) {
            sb.append("（无）\n");
        } else {
            // 带上 id：修正已有记忆时模型必须回传 target_id（否则无法定位要改哪条）
            for (Memory memory : known) {
                sb.append("- #").append(memory.getId()).append(" [").append(memory.getType()).append('·')
                        .append(memory.getImportance()).append("] ")
                        .append(memory.getContent()).append('\n');
            }
            if (memories != null && memories.size() > MAX_MEMORIES) {
                sb.append("（另有 ").append(memories.size() - MAX_MEMORIES)
                        .append(" 条重要度较低的记忆未列出，不要凭空引用它们的 id）\n");
            }
        }

        sb.append("\n【对话窗口】\n");
        int total = 0;
        int shown = 0;
        if (window != null) {
            for (int i = window.size() - 1; i >= 0 && shown < 12; i--) {
                AiMessage message = window.get(i);
                String content = message.getContent() == null ? "" : message.getContent();
                if (content.length() > 2000) {
                    content = content.substring(0, 2000) + "…[截断]";
                }
                if (total + content.length() > 8000) {
                    break;
                }
                total += content.length();
                shown++;
                sb.append("user".equals(message.getRole()) ? "用户：" : "学长：")
                        .append(content).append('\n');
            }
        }
        if (shown == 0) {
            sb.append("（空）\n");
        }
        return sb.toString();
    }

    private static void appendField(StringBuilder target, String label, String value) {
        if (value == null || value.isBlank()) {
            return;
        }
        if (target.length() > 0) {
            target.append(' ');
        }
        target.append(label).append('=').append(value);
    }

    public static String buildParseHtmlSystemPrompt(Schedule schedule, List<PeriodConfig> periods) {
        StringBuilder sb = new StringBuilder();
        sb.append("你是一个课程表解析器。用户会粘贴教务系统页面的 HTML 源码或纯文本，")
                .append("你需要从中提取所有课程信息，输出严格 JSON（不要 markdown 代码块）：\n")
                .append("{\"courses\":[{\"name\":\"课程名\",\"location\":\"地点或null\",\"teacher\":\"教师或null\",")
                .append("\"dayOfWeek\":1-7,\"startPeriod\":1-12,\"endPeriod\":1-12,\"weeks\":[1,2,3]}],\"note\":\"备注说明\"}\n\n")
                .append("规则：\n")
                .append("- 同一门课在不同星期/节次上课，要拆成多条记录\n")
                .append("- \"1-16周\" 展开为 [1,2,...,16]；\"单周\" 只保留奇数周；\"双周\" 只保留偶数周\n")
                .append("- dayOfWeek: 1=周一 ... 7=周日\n")
                .append("- 无法确定的地点/教师设为 null\n")
                .append("- 忽略 HTML 标签、样式、脚本等噪音内容\n");
        if (schedule != null) {
            int totalWeeks = weekOf(schedule.getPeriodStartDate(), schedule.getPeriodEndDate());
            sb.append("- 当前学期共 ").append(totalWeeks).append(" 周，周次不要超出该范围\n");
        }
        if (periods != null && !periods.isEmpty()) {
            sb.append("\n作息时间表（用于把时间段换算成节次）：\n");
            for (PeriodConfig p : periods) {
                sb.append("第").append(p.getPeriodNumber()).append("节 ")
                        .append(p.getStartTime()).append("-").append(p.getEndTime()).append("\n");
            }
        }
        return sb.toString();
    }
}
