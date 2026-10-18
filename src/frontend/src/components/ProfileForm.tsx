import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Input,
  Select,
  Space,
  Typography,
  message,
} from 'antd'
import { useNavigate } from 'react-router-dom'
import { profileApi } from '../api'
import type { StudentProfile } from '../types'

/** 可多选的标签字段：兴趣与技能 */
const TAG_FIELDS = [
  { key: 'interest' as const, label: '兴趣', placeholder: '如：机器学习、篮球、摄影' },
  { key: 'skills' as const, label: '技能', placeholder: '如：Java、Python、英语六级' },
]

const TEXT_FIELDS: { key: keyof StudentProfile; label: string; placeholder: string }[] = [
  { key: 'name', label: '姓名', placeholder: '学长怎么称呼你' },
  { key: 'school', label: '学校', placeholder: '如：示例大学' },
  { key: 'major', label: '专业', placeholder: '如：计算机科学与技术' },
  { key: 'grade', label: '年级', placeholder: '如：大二' },
  { key: 'goal', label: '当前目标', placeholder: '如：通过 12 月 CET-6' },
  { key: 'learningStyle', label: '学习习惯', placeholder: '如：晚上效率高，喜欢番茄钟' },
]

const EMPTY: StudentProfile = {
  id: 0,
  name: '',
  school: '',
  major: '',
  grade: '',
  goal: '',
  interest: [],
  skills: [],
  learningStyle: '',
  updatedBy: null,
}

/** 卡片质感：白底 + 柔影 + 大圆角（明亮风） */
const profileCardStyle = {
  borderRadius: 'var(--b-radius)',
  boxShadow: 'var(--b-sh2)',
} as const

/** 标题前的色条点缀（明亮风分区标识） */
function SectionTitle({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span
        style={{
          width: 4,
          height: 15,
          borderRadius: 99,
          background: color,
          flex: 'none',
        }}
      />
      {children}
    </span>
  )
}

/**
 * 学生档案（AI Campus Agent V1.0）。
 *
 * 档案是 AI 上下文的第一段：填了之后学长的回答、每日计划才会贴合本人。
 * 手动填写与 AI 提案共用同一套字段白名单；这里只负责表单与保存。
 */
export default function ProfileForm() {
  const navigate = useNavigate()
  const [profile, setProfile] = useState<StudentProfile>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await profileApi.get()
      setProfile(data ?? EMPTY)
      setDirty(false)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '档案加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const patch = (changes: Partial<StudentProfile>) => {
    setProfile((prev) => ({ ...prev, ...changes }))
    setDirty(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      const saved = await profileApi.update({
        name: profile.name?.trim() || null,
        school: profile.school?.trim() || null,
        major: profile.major?.trim() || null,
        grade: profile.grade?.trim() || null,
        goal: profile.goal?.trim() || null,
        learningStyle: profile.learningStyle?.trim() || null,
        interest: profile.interest ?? [],
        skills: profile.skills ?? [],
      })
      setProfile(saved)
      setDirty(false)
      message.success('档案已保存，AI 学长会按新档案回答')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card
      title={<SectionTitle color="var(--b-green)">学生档案</SectionTitle>}
      loading={loading}
      style={profileCardStyle}
      extra={
        <Space>
          {dirty && <Typography.Text type="warning">有未保存的修改</Typography.Text>}
          <Button
            className="b-btn-3d"
            type="primary"
            size="small"
            loading={saving}
            disabled={!dirty}
            onClick={() => void save()}
          >
            保存
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="档案是 AI 学长认识你的第一份材料：填了专业、目标和学习习惯，回答和每日计划才会贴合你。"
        />
        {TEXT_FIELDS.map((field) => (
          <div key={String(field.key)}>
            <Typography.Text strong>{field.label}</Typography.Text>
            <Input
              style={{ marginTop: 4 }}
              placeholder={field.placeholder}
              maxLength={100}
              value={(profile[field.key] as string | null) ?? ''}
              onChange={(e) => patch({ [field.key]: e.target.value } as Partial<StudentProfile>)}
            />
          </div>
        ))}
        {TAG_FIELDS.map((field) => (
          <div key={field.key}>
            <Typography.Text strong>{field.label}</Typography.Text>
            <Select
              mode="tags"
              style={{ width: '100%', marginTop: 4 }}
              placeholder={field.placeholder}
              value={profile[field.key] ?? []}
              onChange={(values: string[]) => patch({ [field.key]: values } as Partial<StudentProfile>)}
              tokenSeparators={[',', '，', ' ']}
            />
          </div>
        ))}
        <Space wrap>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            最近更新来源：
          </Typography.Text>
          {profile.updatedBy === 'AI' ? (
            <span className="b-pill purple">AI 学长提炼</span>
          ) : profile.updatedBy === 'USER' ? (
            <span className="b-pill blue">手动填写</span>
          ) : (
            <span
              className="b-pill"
              style={{ background: 'var(--b-bg-soft)', color: 'var(--b-ink-soft)' }}
            >
              尚未填写
            </span>
          )}
          <Button type="link" size="small" onClick={() => navigate('/')}>
            回首页看看 AI 怎么用这份档案
          </Button>
        </Space>
      </Space>
    </Card>
  )
}
