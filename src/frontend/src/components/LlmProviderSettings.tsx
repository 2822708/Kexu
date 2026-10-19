import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { aiApi } from '../api'
import type { LlmProvider, LlmProvidersPayload } from '../types'

/** 卡片质感与设置页其它分区一致（白底 + 柔影 + 大圆角） */
const cardStyle = {
  borderRadius: 'var(--b-radius)',
  boxShadow: 'var(--b-sh2)',
} as const

/** 标题前的色条点缀 */
function SectionTitle({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 4, height: 15, borderRadius: 99, background: color, flex: 'none' }} />
      {children}
    </span>
  )
}

/** 常见 OpenAI 兼容服务的地址与模型，省得用户去翻文档 */
const PRESETS: { id: string; label: string; baseUrl: string; model: string }[] = [
  { id: 'glm', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  {
    id: 'qwen',
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
  },
  { id: 'doubao', label: '豆包', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-pro-32k' },
  { id: 'moonshot', label: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
]

const SOURCE_LABEL: Record<LlmProvider['source'], string> = {
  local: '界面配置',
  config: '配置文件',
  both: '界面覆盖配置',
}

/**
 * 多 AI 服务提供方配置（成本治理 6.1 #2）。
 *
 * <p>存在的理由：{@code app.llm.providers.*} 只能改 yml 或环境变量，桌面单机版用户
 * 没有运维去改这些。只支持 OpenAI 兼容协议的服务——市面上绝大多数国产模型都能用。
 */
export default function LlmProviderSettings() {
  const [data, setData] = useState<LlmProvidersPayload | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm<{
    id: string
    baseUrl: string
    model: string
    apiKey?: string
    timeoutSeconds?: number
    maxTokens?: number
    temperature?: number
  }>()

  const load = useCallback(async () => {
    try {
      setData(await aiApi.listProviders())
    } catch {
      // 加载失败不该炸掉整个设置页；下面会退化成「暂无数据」
      setData(null)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const editable = data?.editable ?? false

  const save = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      // Key 留空表示「不改动现有 Key」：界面上只显示掩码，用户改模型名时不该把 Key 清掉
      const apiKey = values.apiKey?.trim()
      setData(
        await aiApi.saveProvider({
          id: values.id.trim(),
          baseUrl: values.baseUrl.trim(),
          model: values.model.trim(),
          ...(apiKey ? { apiKey } : {}),
          ...(values.timeoutSeconds ? { timeoutSeconds: values.timeoutSeconds } : {}),
          ...(values.maxTokens ? { maxTokens: values.maxTokens } : {}),
        }),
      )
      message.success('已保存，立即生效（无需重启）')
      form.resetFields()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    try {
      setData(await aiApi.removeProvider(id))
      message.success(`已删除 ${id} 的界面配置`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除失败')
    }
  }

  const columns: ColumnsType<LlmProvider> = [
    {
      title: '服务',
      dataIndex: 'id',
      render: (id: string) => <strong>{id}</strong>,
    },
    {
      title: '模型',
      dataIndex: 'model',
      render: (model: string) => model || <Typography.Text type="secondary">未填</Typography.Text>,
    },
    {
      title: '地址',
      dataIndex: 'baseUrl',
      responsive: ['lg'],
      render: (url: string) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {url || '未填'}
        </Typography.Text>
      ),
    },
    {
      title: 'Key',
      dataIndex: 'keyMasked',
      render: (masked: string) =>
        masked ? (
          <Typography.Text code>{masked}</Typography.Text>
        ) : (
          <Tag color="warning">未填</Tag>
        ),
    },
    {
      title: '状态',
      dataIndex: 'configured',
      render: (configured: boolean, row) => (
        <Space size={6} wrap>
          <Tag color={configured ? 'success' : 'default'}>{configured ? '可用' : '未完成'}</Tag>
          <Tag>{SOURCE_LABEL[row.source]}</Tag>
        </Space>
      ),
    },
  ]

  if (!editable) {
    return (
      <Card title={<SectionTitle color="var(--b-purple)">AI 服务提供方</SectionTitle>} style={cardStyle}>
        <Alert
          type="info"
          showIcon
          message="当前部署的 AI 服务由管理员通过环境变量或配置文件管理"
          description={
            data?.providers.length
              ? `已配置：${data.providers.map((p) => `${p.id}（${p.model}）`).join('、')}`
              : '尚未配置任何服务提供方'
          }
        />
      </Card>
    )
  }

  return (
    <Card title={<SectionTitle color="var(--b-purple)">AI 服务提供方</SectionTitle>} style={cardStyle}>
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          支持任意 OpenAI 兼容服务（智谱 GLM、通义千问、豆包、Kimi、自建网关等）。
          填好保存后立即生效，不需要重启。Key 会加密保存在本机配置中。
        </Typography.Text>

        {data?.providers.length ? (
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            columns={[
              ...columns,
              {
                title: '',
                key: 'actions',
                width: 90,
                render: (_: unknown, row) =>
                  row.source === 'config' ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      只读
                    </Typography.Text>
                  ) : (
                    <Popconfirm
                      title={`删除 ${row.id} 的界面配置？`}
                      description="删除后回退到配置文件里的值（如果有）。"
                      okText="删除"
                      cancelText="取消"
                      onConfirm={() => void remove(row.id)}
                    >
                      <Button size="small" danger type="text">
                        删除
                      </Button>
                    </Popconfirm>
                  ),
              },
            ]}
            dataSource={data.providers}
          />
        ) : (
          <Typography.Text type="secondary">还没有配置任何服务提供方。</Typography.Text>
        )}

        {data?.ready.length ? (
          <Alert
            type="success"
            showIcon
            message={`当前可用：${data.ready.join('、')}`}
          />
        ) : data ? (
          <Alert
            type="warning"
            showIcon
            message="当前没有可用的服务提供方，AI 功能会返回「服务未配置」"
          />
        ) : null}

        <Form form={form} layout="vertical" requiredMark={false} style={{ marginTop: 4 }}>
          <Space size={12} wrap style={{ width: '100%' }}>
            <Form.Item
              name="id"
              label="标识"
              rules={[
                { required: true, message: '请填写标识' },
                {
                  pattern: /^[a-z0-9][a-z0-9_-]{0,31}$/,
                  message: '小写字母、数字、下划线或连字符，不超过 32 位',
                },
                {
                  validator: (_, value) =>
                    value === 'deepseek'
                      ? Promise.reject(new Error('deepseek 请在「AI 助手」卡片中配置'))
                      : Promise.resolve(),
                },
              ]}
              style={{ minWidth: 150, flex: 1 }}
            >
              <Input placeholder="glm" />
            </Form.Item>
            <Form.Item
              name="model"
              label="模型"
              rules={[{ required: true, message: '请填写模型名' }]}
              style={{ minWidth: 180, flex: 1 }}
            >
              <Input placeholder="glm-4-flash" />
            </Form.Item>
          </Space>
          <Form.Item
            name="baseUrl"
            label="服务地址"
            rules={[
              { required: true, message: '请填写服务地址' },
              { pattern: /^https?:\/\/.+/i, message: '必须以 http:// 或 https:// 开头' },
            ]}
          >
            <Input placeholder="https://open.bigmodel.cn/api/paas/v4" />
          </Form.Item>
          <Form.Item
            name="apiKey"
            label="API Key"
            extra="留空表示不改动已保存的 Key。"
          >
            <Input.Password placeholder="填过一次之后这里可以留空" autoComplete="off" />
          </Form.Item>
          <Space size={8} wrap>
            <Button type="primary" loading={saving} onClick={() => void save()}>
              保存并生效
            </Button>
            {PRESETS.map((preset) => (
              <Button
                key={preset.id}
                size="small"
                onClick={() =>
                  form.setFieldsValue({
                    id: preset.id,
                    baseUrl: preset.baseUrl,
                    model: preset.model,
                  })
                }
              >
                {preset.label}
              </Button>
            ))}
          </Space>
        </Form>
      </Space>
    </Card>
  )
}
