package com.tangent.timetable.core.domain

data class CourseSlot(
    val publicId: String,
    val dayOfWeek: Int,
    val startPeriod: Int,
    val endPeriod: Int,
    val weeks: Set<Int>,
)

object CourseRules {
    fun findConflict(candidate: CourseSlot, existing: Iterable<CourseSlot>): CourseSlot? {
        require(candidate.dayOfWeek in 1..7) { "星期范围必须为 1 到 7" }
        require(candidate.startPeriod >= 1) { "开始节次必须至少为第 1 节" }
        require(candidate.endPeriod >= candidate.startPeriod) { "结束节次不能早于开始节次" }
        require(candidate.weeks.isNotEmpty()) { "至少选择一个教学周" }
        require(candidate.weeks.all { it >= 1 }) { "教学周必须为正整数" }

        return existing.firstOrNull { other ->
            other.publicId != candidate.publicId &&
                other.dayOfWeek == candidate.dayOfWeek &&
                candidate.startPeriod <= other.endPeriod &&
                other.startPeriod <= candidate.endPeriod &&
                candidate.weeks.any(other.weeks::contains)
        }
    }
}
