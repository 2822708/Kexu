import { useMemo, useRef, useState } from 'react'
import { Alert, Button, Input, Modal, Result, Space, Steps, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { Course, CoursePayload, ParsedCourse, ParseHtmlResult } from '../types'
import { formatWeeks, weekDayName } from '../utils/schedule'
import { diagnoseCourses, importPayload, type ImportRow } from '../utils/importDiagnostics'

interface Props {
  open: boolean
  aiEnabled: boolean
  scheduleName: string
  totalWeeks: number
  periodNumbers: number[]
  existingCourses: Course[]
  onCancel: () => void
  onParse: (html: string) => Promise<ParseHtmlResult>
  onImport: (courses: CoursePayload[]) => Promise<void>
}

export default function ImportHtmlModal({
  open, aiEnabled, scheduleName, totalWeeks, periodNumbers, existingCourses, onCancel, onParse, onImport,
}: Props) {
  const [step, setStep] = useState(0)
  const [html, setHtml] = useState('')
  const [parsed, setParsed] = useState<ParsedCourse[]>([])
  const [note, setNote] = useState('')
  const [diagnostics, setDiagnostics] = useState<NonNullable<ParseHtmlResult['diagnostics']>>([])
  const [selectedKeys, setSelectedKeys] = useState<number[]>([])
  const [importedCount, setImportedCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestVersion = useRef(0)
  const rows = useMemo(() => diagnoseCourses(parsed, existingCourses, totalWeeks, periodNumbers),
    [parsed, existingCourses, totalWeeks, periodNumbers])
  const validRows = rows.filter((r) => r.errors.length === 0)
  const picked = validRows.filter((r) => selectedKeys.includes(r.key))

  const close = () => {
    if (loading) return
    requestVersion.current++
    setStep(0); setHtml(''); setParsed([]); setNote(''); setDiagnostics([]); setSelectedKeys([]); setError(null)
    onCancel()
  }

  const doParse = async () => {
    const version = ++requestVersion.current
    setLoading(true); setError(null)
    try {
      const result = await onParse(html)
      if (version !== requestVersion.current) return
      setDiagnostics(result.diagnostics ?? [])
      if (!Array.isArray(result.courses) || result.courses.length === 0) {
        setError('AI 未解析出可预览的课程，请检查原文或下方字段类型提示。')
        return
      }
      const next = diagnoseCourses(result.courses, existingCourses, totalWeeks, periodNumbers)
      setParsed(result.courses)
      setNote(typeof result.note === 'string' ? result.note : '')
      setSelectedKeys(next.filter((r) => !r.errors.length && !r.warnings.length).map((r) => r.key))
      setStep(1)
    } catch (e) {
      setError(e instanceof Error ? e.message : '解析失败')
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }

  const doImport = async () => {
    if (!picked.length || loading) return
    setLoading(true); setError(null)
    try {
      await onImport(picked.map(importPayload))
      setImportedCount(picked.length)
      setStep(2)
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入失败')
    } finally {
      setLoading(false)
    }
  }

  const columns: ColumnsType<ImportRow> = [
    { title: '行', dataIndex: 'key', width: 48, render: (v: number) => v + 1 },
    { title: '课程', dataIndex: 'name', render: (v: string | null) => v || '缺失' },
    { title: '地点 / 教师', render: (_, r) => `${r.location || '未指定'} / ${r.teacher || '未指定'}` },
    { title: '时间', render: (_, r) => `${weekDayName(r.dayOfWeek ?? 0)} · ${r.startPeriod ?? '?'}–${r.endPeriod ?? '?'} 节` },
    { title: '周次', dataIndex: 'weeks', render: (v: number[]) => formatWeeks(v) },
    {
      title: '检查结果', width: 270,
      render: (_, r) => <Space direction="vertical" size={2}>
        {r.errors.map((issue) => <Typography.Text type="danger" key={issue}>{issue}</Typography.Text>)}
        {r.warnings.map((issue) => <Typography.Text type="warning" key={issue}>{issue}</Typography.Text>)}
        {!r.errors.length && !r.warnings.length && <Tag color="green">可导入</Tag>}
      </Space>,
    },
  ]

  return <Modal open={open} maskClosable={false} title={`导入课表 · ${scheduleName}`}
    onCancel={close} closable={!loading} keyboard={!loading} width={1080} footer={null} destroyOnHidden>
    <Steps current={step} size="small" items={[{ title: '粘贴内容' }, { title: '检查并选择' }, { title: '完成' }]}
      style={{ marginBottom: 16 }} />
    {!aiEnabled && <Alert type="warning" showIcon message="AI 功能未启用，请先在设置中完成配置。" style={{ marginBottom: 16 }} />}
    {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
    {diagnostics.length > 0 && <Alert type="warning" showIcon message="部分 AI 解析结果已跳过"
      description={<ul style={{ maxHeight: 160, overflow: 'auto', margin: 0, paddingLeft: 20 }}>
        {diagnostics.map((item) => <li key={item.row}>AI 返回第 {item.row} 行：{item.message}</li>)}
      </ul>} style={{ marginBottom: 12 }} />}
    {step === 0 && <>
      <Typography.Paragraph type="secondary">
        在教务系统打开课程表，将页面文字或 HTML 源码粘贴在下方。内容会发送给 AI 服务解析，
        请先移除姓名、学号和其它无需导入的个人信息。最多 60,000 字符。
      </Typography.Paragraph>
      <Input.TextArea rows={12} value={html} onChange={(e) => setHtml(e.target.value)}
        showCount maxLength={60000} disabled={loading} placeholder="粘贴教务系统课表页面的 HTML 或文字…" />
      <Space style={{ marginTop: 24, justifyContent: 'flex-end', width: '100%' }}>
        <Button disabled={loading} onClick={close}>取消</Button>
        <Button type="primary" loading={loading} disabled={!aiEnabled || html.trim().length < 10} onClick={doParse}>AI 解析</Button>
      </Space>
    </>}
    {step === 1 && <>
      <Typography.Paragraph>
        目标：<strong>{scheduleName}</strong>（共 {totalWeeks} 周）。解析 {rows.length} 行，
        {rows.length - validRows.length} 行无法导入，{validRows.filter((r) => r.warnings.length).length} 行需核对。
      </Typography.Paragraph>
      {note && <Alert type="info" showIcon message="解析说明" description={note} style={{ marginBottom: 12 }} />}
      <Alert type="info" showIcon message="缺失、越界和完全重复的课程已禁选。时间冲突行默认不选；核对后可手动勾选。"
        description="只导入勾选的有效行，其余课程保持原样。需要修改的行可返回上一步调整原文后重新解析。"
        style={{ marginBottom: 12 }} />
      <Button size="small" disabled={loading} onClick={() => setSelectedKeys(validRows.filter((r) => !r.warnings.length).map((r) => r.key))}
        style={{ marginBottom: 8 }}>仅选择无问题行</Button>
      <Table size="small" rowKey="key" columns={columns} dataSource={rows} pagination={false} scroll={{ y: 380, x: 850 }}
        rowSelection={{ selectedRowKeys: picked.map((r) => r.key), onChange: (keys) => setSelectedKeys(keys as number[]),
          getCheckboxProps: (r) => ({ disabled: loading || r.errors.length > 0 }) }} />
      <Space style={{ marginTop: 16, justifyContent: 'flex-end', width: '100%' }}>
        <Button disabled={loading} onClick={close}>取消</Button>
        <Button disabled={loading} onClick={() => setStep(0)}>上一步</Button>
        <Button type="primary" loading={loading} disabled={!picked.length} onClick={doImport}>导入已选 {picked.length} 行</Button>
      </Space>
    </>}
    {step === 2 && <Result status="success" title="导入完成" subTitle={`已向「${scheduleName}」导入 ${importedCount} 门课程`}
      extra={<Button type="primary" onClick={close}>返回课表</Button>} />}
  </Modal>
}
