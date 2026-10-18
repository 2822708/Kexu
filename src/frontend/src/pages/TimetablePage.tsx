import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, Empty, Radio, Segmented, Space, Typography, message } from 'antd'
import {
  ImportOutlined,
  LeftOutlined,
  PlusOutlined,
  RightOutlined,
  SettingOutlined,
  TrophyOutlined,
} from '@ant-design/icons'
import TimetableGrid from '../components/TimetableGrid'
import CourseListView from '../components/CourseListView'
import CourseDayView from '../components/CourseDayView'
import CourseFormModal from '../components/CourseFormModal'
import ScheduleManagerModal from '../components/ScheduleManagerModal'
import ScheduleCreateModal from '../components/ScheduleCreateModal'
import ImportHtmlModal from '../components/ImportHtmlModal'
import ExamManagerModal from '../components/ExamManagerModal'
import { aiApi, courseApi, examApi, scheduleApi } from '../api'
import { useApp } from '../store/AppContext'
import type { Course, CoursePayload, Exam, ExamPayload, Schedule } from '../types'
import { currentWeekOf, dayjs, totalWeeks } from '../utils/schedule'
import { LOCAL_MODE } from '../local/mode'
import {
  assertEditorRecord,
  assertEditorGeneration,
  assertEditorScope,
  captureEditorScope,
  LocalEditorScopeError,
  recordPublicId,
  type LocalEditorScope,
} from '../local/editorScope'
import '../day-agenda.css'

export default function TimetablePage() {
  const {
    activeSchedule,
    activeScheduleId,
    schedules,
    courses,
    exams,
    periods,
    refreshCourses,
    refreshExams,
    refreshSchedules,
    refreshTodos,
  } = useApp()

  const [week, setWeek] = useState(1)
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'all'>(() =>
    window.matchMedia('(max-width: 767px)').matches ? 'day' : 'week',
  )
  const [selectedDate, setSelectedDate] = useState(() => dayjs().format('YYYY-MM-DD'))
  const [courseModal, setCourseModal] = useState<{
    open: boolean
    course: Course | null
    defaults: { dayOfWeek?: number; startPeriod?: number } | null
    scope: LocalEditorScope | null
  }>({ open: false, course: null, defaults: null, scope: null })
  const [saving, setSaving] = useState(false)
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importScope, setImportScope] = useState<LocalEditorScope | null>(null)
  const importGeneration = useRef(0)
  const [examModalOpen, setExamModalOpen] = useState(false)
  const [examScope, setExamScope] = useState<LocalEditorScope | null>(null)
  const [examSaving, setExamSaving] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(false)
  const activeScheduleRef = useRef(activeSchedule)
  activeScheduleRef.current = activeSchedule
  const activePublicId = recordPublicId(activeSchedule)
  const closeBoundEditors = useCallback(() => {
    importGeneration.current++
    setCourseModal({ open: false, course: null, defaults: null, scope: null })
    setImportOpen(false)
    setImportScope(null)
    setExamModalOpen(false)
    setExamScope(null)
  }, [])
  useEffect(() => {
    if (!LOCAL_MODE) return
    const mismatched = (scope: LocalEditorScope | null) =>
      !scope || scope.scheduleId !== activeScheduleId || scope.schedulePublicId !== activePublicId
    if (
      (courseModal.open && mismatched(courseModal.scope)) ||
      (importOpen && mismatched(importScope)) ||
      (examModalOpen && mismatched(examScope))
    ) {
      closeBoundEditors()
      message.warning(
        '当前课表已切换或恢复替换，原编辑窗口已关闭；未保存的草稿已丢弃，请在目标课表重新录入。',
      )
    }
  }, [
    activeScheduleId,
    activePublicId,
    courseModal.open,
    courseModal.scope,
    importOpen,
    importScope,
    examModalOpen,
    examScope,
    closeBoundEditors,
  ])
  useEffect(
    () => () => {
      importGeneration.current++
    },
    [],
  )
  const validateScope = async (
    scope: LocalEditorScope | null,
    record?: { collection: 'courses' | 'exams'; value: Course | Exam },
  ) => {
    if (!LOCAL_MODE) return activeScheduleId
    const { readLocalState } = await import('../local/db')
    const state = await readLocalState()
    assertEditorScope(scope, activeScheduleRef.current, state)
    if (record) assertEditorRecord(state, scope, record.collection, record.value)
    return scope.scheduleId
  }
  const handleScopeFailure = (error: unknown, generation: number) => {
    // A late failure from a previous window must never discard a newer draft.
    if (
      LOCAL_MODE &&
      error instanceof LocalEditorScopeError &&
      generation === importGeneration.current
    )
      closeBoundEditors()
  }
  const openExamManager = () => {
    try {
      importGeneration.current++
      setExamScope(LOCAL_MODE ? captureEditorScope(activeScheduleRef.current) : null)
      setExamModalOpen(true)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '请先选择课表')
    }
  }
  const openImport = () => {
    try {
      importGeneration.current++
      setImportScope(LOCAL_MODE ? captureEditorScope(activeScheduleRef.current) : null)
      setImportOpen(true)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '请先选择课表')
    }
  }
  const openEditCourse = (course: Course) => {
    try {
      importGeneration.current++
      setCourseModal({
        open: true,
        course,
        defaults: null,
        scope: LOCAL_MODE ? captureEditorScope(activeScheduleRef.current) : null,
      })
    } catch (error) {
      message.error(error instanceof Error ? error.message : '请先选择课表')
    }
  }

  const total = useMemo(
    () =>
      activeSchedule
        ? totalWeeks(activeSchedule.periodStartDate, activeSchedule.periodEndDate)
        : 20,
    [activeSchedule],
  )

  const realCurrentWeek = useMemo(() => {
    if (!activeSchedule) return 1
    return Math.min(Math.max(currentWeekOf(activeSchedule.periodStartDate), 1), total)
  }, [activeSchedule, total])

  useEffect(() => {
    setWeek(realCurrentWeek)
  }, [realCurrentWeek])

  useEffect(() => {
    aiApi
      .status()
      .then((s) => setAiEnabled(s.enabled))
      .catch(() => setAiEnabled(false))
  }, [])

  const openCreate = useCallback(
    (dayOfWeek?: number, startPeriod?: number) => {
      if (!activeScheduleId) {
        message.warning('请先创建或选择一个课表')
        return
      }
      try {
        importGeneration.current++
        setCourseModal({
          open: true,
          course: null,
          defaults: { dayOfWeek, startPeriod },
          scope: LOCAL_MODE ? captureEditorScope(activeScheduleRef.current) : null,
        })
      } catch (error) {
        message.error(error instanceof Error ? error.message : '请先选择课表')
      }
    },
    [activeScheduleId],
  )

  const submitCourse = async (payload: CoursePayload) => {
    if (!activeScheduleId) return
    setSaving(true)
    const generation = importGeneration.current
    try {
      const target = await validateScope(
        courseModal.scope,
        courseModal.course ? { collection: 'courses', value: courseModal.course } : undefined,
      )
      if (!target) throw new Error('请先选择课表')
      if (courseModal.course) {
        await courseApi.update(courseModal.course.id, payload)
        message.success('课程已更新')
      } else {
        await courseApi.create(target, payload)
        message.success('课程已添加')
      }
      if (generation === importGeneration.current)
        setCourseModal({ open: false, course: null, defaults: null, scope: null })
      await refreshCourses()
    } catch (e) {
      handleScopeFailure(e, generation)
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const deleteCourse = async (course: Course) => {
    const generation = importGeneration.current
    try {
      await validateScope(
        courseModal.open && courseModal.course?.id === course.id
          ? courseModal.scope
          : LOCAL_MODE
            ? captureEditorScope(activeScheduleRef.current)
            : null,
        { collection: 'courses', value: course },
      )
      await courseApi.remove(course.id)
      message.success('课程已删除')
      if (generation === importGeneration.current)
        setCourseModal({ open: false, course: null, defaults: null, scope: null })
      await refreshCourses()
    } catch (e) {
      handleScopeFailure(e, generation)
      message.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  const createSchedule = async (payload: Omit<Schedule, 'id'>) => {
    await scheduleApi.create(payload)
    message.success('课表已创建')
    await refreshSchedules()
  }

  const updateSchedule = async (id: number, payload: Omit<Schedule, 'id'>) => {
    await scheduleApi.update(id, payload)
    message.success('课表已更新')
    await refreshSchedules()
  }

  const deleteSchedule = async (id: number) => {
    await scheduleApi.remove(id)
    message.success('课表已删除')
    await refreshSchedules()
    await refreshCourses()
    await Promise.all([refreshExams(), refreshTodos()])
  }

  const createExam = async (payload: ExamPayload) => {
    if (!activeScheduleId) throw new Error('请先选择课表')
    setExamSaving(true)
    const generation = importGeneration.current
    try {
      const target = await validateScope(examScope)
      if (!target) throw new Error('请先选择课表')
      await examApi.create(target, payload)
      message.success('考试已添加')
      await Promise.all([refreshExams(), refreshTodos()]).catch(() =>
        message.warning('考试已保存，列表刷新失败，请稍后刷新'),
      )
    } catch (e) {
      handleScopeFailure(e, generation)
      message.error(e instanceof Error ? e.message : '保存失败')
      throw e
    } finally {
      setExamSaving(false)
    }
  }

  const updateExam = async (id: number, payload: ExamPayload, expectedExam?: Exam) => {
    setExamSaving(true)
    const generation = importGeneration.current
    try {
      const original = expectedExam ?? exams.find((e) => e.id === id)
      if (LOCAL_MODE && !original)
        throw new LocalEditorScopeError('原考试已删除，请重新打开考试管理')
      await validateScope(
        examScope,
        original ? { collection: 'exams', value: original } : undefined,
      )
      await examApi.update(id, payload)
      message.success('考试已更新')
      await Promise.all([refreshExams(), refreshTodos()]).catch(() =>
        message.warning('考试已保存，列表刷新失败，请稍后刷新'),
      )
    } catch (e) {
      handleScopeFailure(e, generation)
      message.error(e instanceof Error ? e.message : '保存失败')
      throw e
    } finally {
      setExamSaving(false)
    }
  }

  const deleteExam = async (exam: Exam) => {
    const generation = importGeneration.current
    try {
      await validateScope(examScope, { collection: 'exams', value: exam })
      await examApi.remove(exam.id)
      message.success('考试已删除')
      await Promise.all([refreshExams(), refreshTodos()])
    } catch (e) {
      handleScopeFailure(e, generation)
      message.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  if (schedules.length === 0) {
    return (
      <Card>
        <Empty description="还没有课表，先创建一个学期课表吧">
          <Space>
            <Button type="primary" onClick={() => setCreateOpen(true)}>
              新建课表
            </Button>
          </Space>
        </Empty>
        <ScheduleCreateModal
          open={createOpen}
          onCancel={() => setCreateOpen(false)}
          onCreate={createSchedule}
        />
        <ScheduleManagerModal
          open={scheduleModalOpen}
          schedules={schedules}
          onCancel={() => setScheduleModalOpen(false)}
          onCreate={createSchedule}
          onUpdate={updateSchedule}
          onDelete={deleteSchedule}
        />
      </Card>
    )
  }

  return (
    <div className="tt-page">
      <div className="page-header">
        <Space size={12} wrap>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {activeSchedule?.name ?? '课表'}
          </Typography.Title>
          <Segmented
            value={viewMode}
            onChange={(v) => setViewMode(v as 'day' | 'week' | 'all')}
            options={[
              { value: 'day', label: '按日' },
              { value: 'week', label: '按周' },
              { value: 'all', label: '全部课程' },
            ]}
          />
          {viewMode === 'week' && (
            <Space size={4}>
              <Button
                size="small"
                icon={<LeftOutlined />}
                disabled={week <= 1}
                onClick={() => setWeek((w) => Math.max(1, w - 1))}
              />
              <Typography.Text strong style={{ minWidth: 110, textAlign: 'center' }}>
                第 {week} 周 / 共 {total} 周
              </Typography.Text>
              <Button
                size="small"
                icon={<RightOutlined />}
                disabled={week >= total}
                onClick={() => setWeek((w) => Math.min(total, w + 1))}
              />
              <Radio.Group
                size="small"
                value={week === realCurrentWeek ? 'now' : ''}
                onChange={() => setWeek(realCurrentWeek)}
              >
                <Radio.Button value="now">本周</Radio.Button>
              </Radio.Group>
            </Space>
          )}
        </Space>

        <Space wrap>
          <Button icon={<PlusOutlined />} type="primary" onClick={() => openCreate()}>
            添加课程
          </Button>
          <Button icon={<TrophyOutlined />} onClick={openExamManager}>
            考试管理
          </Button>
          <Button icon={<ImportOutlined />} onClick={openImport}>
            导入课表
          </Button>
          <Button icon={<SettingOutlined />} onClick={() => setScheduleModalOpen(true)}>
            课表管理
          </Button>
        </Space>
      </div>

      {viewMode === 'day' && activeSchedule ? (
        <CourseDayView
          date={selectedDate}
          schedule={activeSchedule}
          courses={courses}
          exams={exams}
          periods={periods}
          onDateChange={(date) => {
            setSelectedDate(date)
            setWeek(
              Math.min(
                total,
                Math.max(1, currentWeekOf(activeSchedule.periodStartDate, dayjs(date))),
              ),
            )
          }}
          onEdit={openEditCourse}
          onExamClick={openExamManager}
          onCreate={openCreate}
        />
      ) : viewMode === 'week' ? (
        <div className="tt-scroll">
          <TimetableGrid
            courses={courses}
            exams={exams}
            periods={periods}
            week={week}
            semesterStart={activeSchedule?.periodStartDate ?? null}
            onCourseClick={openEditCourse}
            onExamClick={openExamManager}
            onEmptyClick={(day, period) => openCreate(day, period)}
          />
        </div>
      ) : (
        <div className="tt-list">
          <CourseListView courses={courses} onEdit={openEditCourse} onDelete={deleteCourse} />
        </div>
      )}

      <CourseFormModal
        open={courseModal.open}
        course={courseModal.course}
        defaults={courseModal.defaults}
        periods={periods}
        totalWeeks={total}
        currentWeek={realCurrentWeek}
        saving={saving}
        onCancel={() => {
          importGeneration.current++
          setCourseModal({ open: false, course: null, defaults: null, scope: null })
        }}
        onSubmit={submitCourse}
        onDelete={deleteCourse}
      />

      <ScheduleManagerModal
        open={scheduleModalOpen}
        schedules={schedules}
        onCancel={() => setScheduleModalOpen(false)}
        onCreate={createSchedule}
        onUpdate={updateSchedule}
        onDelete={deleteSchedule}
      />

      <ImportHtmlModal
        key={LOCAL_MODE ? `${activeScheduleId}:${importGeneration.current}` : activeScheduleId}
        open={importOpen}
        aiEnabled={aiEnabled}
        scheduleName={activeSchedule?.name ?? '未选择课表'}
        totalWeeks={total}
        periodNumbers={periods.map((p) => p.periodNumber)}
        existingCourses={courses}
        onCancel={() => {
          importGeneration.current++
          setImportOpen(false)
          setImportScope(null)
        }}
        onParse={async (html) => {
          const generation = importGeneration.current
          try {
            const target = await validateScope(importScope)
            if (LOCAL_MODE) assertEditorGeneration(generation, importGeneration.current)
            const result = await aiApi.parseHtml(html, target)
            if (LOCAL_MODE) {
              assertEditorGeneration(generation, importGeneration.current)
              await validateScope(importScope)
              assertEditorGeneration(generation, importGeneration.current)
            }
            return result
          } catch (error) {
            handleScopeFailure(error, generation)
            throw error
          }
        }}
        onImport={async (list) => {
          const generation = importGeneration.current
          try {
            const target = await validateScope(importScope)
            if (!target) throw new Error('请先选择课表')
            if (LOCAL_MODE) assertEditorGeneration(generation, importGeneration.current)
            await courseApi.batchCreate(target, list)
            await refreshCourses()
          } catch (error) {
            handleScopeFailure(error, generation)
            throw error
          }
        }}
      />

      <ExamManagerModal
        key={
          LOCAL_MODE
            ? `${examScope?.scheduleId ?? 'closed'}:${examScope?.schedulePublicId ?? ''}:${importGeneration.current}`
            : undefined
        }
        open={examModalOpen}
        exams={exams}
        saving={examSaving}
        onCancel={() => {
          importGeneration.current++
          setExamModalOpen(false)
          setExamScope(null)
        }}
        onCreate={createExam}
        onUpdate={updateExam}
        onDelete={deleteExam}
      />
    </div>
  )
}
