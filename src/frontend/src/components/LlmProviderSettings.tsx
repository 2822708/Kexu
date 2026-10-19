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
import type { LlmProbeResult, LlmProvider, LlmProvidersPayload } from '../types'

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

/** 耗时显示：不到 1 秒给毫秒，超过就给秒，避免「12345ms」这种要数位数的写法 */
function formatLatency(ms: number): string {
  if (!ms || ms < 0) {
    return '—'
  }
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

/**
 * 顶部状态条：现在到底在用谁。
 *
 * <p>三种状态刻意用三种颜色，因为它们的严重程度完全不同：
 * 正常（绿）/ 一条都不能用（红）/ <b>设的那个不可用、正在兜底</b>（警告）。
 * 最后一种最需要喊出来——用户以为在用的是 A，实际在跑的是 B，账单和效果都对不上，
 * 而且界面上不写清楚就永远发现不了。
 */
function ActiveProviderBanner({
  data,
  busy,
  onReset,
}: {
  data: LlmProvidersPayload
  busy: string | null
  onReset: () => void
}) {
  const { activeProvider, activeSource, configActiveProvider, ready } = data

  if (!ready.length) {
    return (
      <Alert
        type="error"
        showIcon
        message="当前没有可用的服务提供方，AI 功能会返回「服务未配置」"
        description="填好地址、模型名和 API Key 并保存后即可使用。"
      />
    )
  }

  if (activeSource === 'fallback') {
    return (
      <Alert
        type="warning"
        showIcon
        message={`默认服务「${activeProvider}」当前不可用，正在使用：${ready.join('、')}`}
        description={
          <Space direction="vertical" size={4}>
            <Typography.Text style={{ fontSize: 12 }}>
              它的地址、模型名或 Key 还没填全。请在下方补全，或换一个能用的设为默认。
            </Typography.Text>
            <Button size="small" onClick={onReset} loading={busy === '__reset__'}>
              改回配置文件里的「{configActiveProvider}」
            </Button>
          </Space>
        }
      />
    )
  }

  return (
    <Alert
      type="success"
      showIcon
      message={
        <Space size={8} wrap>
          <span>
            当前默认：<strong>{activeProvider}</strong>
          </span>
          <Tag color="processing">{activeSource === 'local' ? '界面设置' : '配置文件'}</Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            可用：{ready.join('、')}
          </Typography.Text>
        </Space>
      }
      action={
        activeSource === 'local' ? (
          <Button size="small" type="text" onClick={onReset} loading={busy === '__reset__'}>
            改回「{configActiveProvider}」
          </Button>
        ) : null
      }
    />
  )
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
  /**
   * 每行一个测试状态：正在测的 id 进 testing，最近一次结果留在 probeResults 里。
   *
   * <p>为什么不用 toast 就完事：失败原因常有六七十个字（要告诉用户是地址错、Key 错还是
   * 模型名错），toast 一闪就没了。表格下面留一块结果区，用户能慢慢看、能对照着改。
   */
  const [testing, setTesting] = useState<string | null>(null)
  const [probeResults, setProbeResults] = useState<Record<string, LlmProbeResult>>({})
  /** 结果区只展示最近测的那一条，全都铺开会显得页面很吵 */
  const [lastProbed, setLastProbed] = useState<string | null>(null)
  /** 正在切换默认的值（逐行 loading，避免连点） */
  const [switching, setSwitching] = useState<string | null>(null)
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

  /** 丢掉某个 provider 的测试结论（删除配置、或保存了新配置后都要丢） */
  const forgetProbe = (id: string) => {
    setProbeResults((prev) => {
      if (!(id in prev)) {
        return prev
      }
      const next = { ...prev }
      delete next[id]
      return next
    })
    setLastProbed((current) => (current === id ? null : current))
  }

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
      // 改了地址/模型/Key 之后，上次的「可用」结论就过期了，留着会让人误判
      forgetProbe(values.id.trim())
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
      // 配置都没了，留着「上次测试可用」会误导：用户可能以为还在用这个服务
      forgetProbe(id)
      message.success(`已删除 ${id} 的界面配置`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除失败')
    }
  }

  /**
   * 把某个 provider 设为默认。
   *
   * <p>失败必须原样报出后端给的 reason：最常见的原因是「配置不全」，用户需要知道
   * 缺的是哪一样，而不是笼统的「切换失败」。
   */
  const activate = async (id: string) => {
    setSwitching(id)
    try {
      setData(await aiApi.setActiveProvider(id))
      message.success(`已切换到 ${id}，下次对话就用它`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '切换默认服务失败', 8)
    } finally {
      setSwitching(null)
    }
  }

  /** 回到配置文件设定的默认值 */
  const resetActive = async () => {
    setSwitching('__reset__')
    try {
      setData(await aiApi.resetActiveProvider())
      message.success('已回退到配置文件设定的默认服务')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败')
    } finally {
      setSwitching(null)
    }
  }

  /**
   * 测一次连通性。
   *
   * <p>成功和失败都不弹 error toast——失败原因要能停留着看。只有「请求本身没发出去」
   * （网络断了、403 之类）才用 message.error，因为那种情况没有结果对象可展示。
   */
  const probe = async (id: string) => {
    setTesting(id)
    try {
      const result = await aiApi.testProvider(id)
      setProbeResults((prev) => ({ ...prev, [id]: result }))
      setLastProbed(id)
      if (result.ok) {
        message.success(`${id} 可用（${formatLatency(result.latencyMs)}）`)
      } else {
        // 原因已经在结果区展示了，这里只提醒去看
        message.warning(`${id} 测试未通过，原因见下方`)
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '测试请求失败')
    } finally {
      setTesting(null)
    }
  }

  /** 结果区要展示的那一条；没有就渲染空 */
  const probeShown = lastProbed ? probeResults[lastProbed] : undefined

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
          {row.id === data?.activeProvider ? (
            <Tag color="processing">默认</Tag>
          ) : null}
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
                width: 210,
                render: (_: unknown, row) => {
                  const result = probeResults[row.id]
                  const isActive = row.id === data?.activeProvider
                  return (
                    <Space size={2}>
                      {isActive ? null : (
                        <Button
                          size="small"
                          type="link"
                          /* 配置不全的 provider 当默认会让 AI 整体不可用，后端也会拒，这里先禁掉少一次往返 */
                          disabled={!row.configured || switching !== null}
                          loading={switching === row.id}
                          onClick={() => void activate(row.id)}
                        >
                          设为默认
                        </Button>
                      )}
                      <Button
                        size="small"
                        type="link"
                        loading={testing === row.id}
                        /* 配置不全就不必浪费一次往返，直接告诉用户缺什么 */
                        disabled={!row.configured || (testing !== null && testing !== row.id)}
                        onClick={() => void probe(row.id)}
                      >
                        {result?.ok ? '重新测试' : '测试'}
                      </Button>
                      {row.source === 'config' ? (
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
                      )}
                    </Space>
                  )
                },
              },
            ]}
            dataSource={data.providers}
          />
        ) : (
          <Typography.Text type="secondary">还没有配置任何服务提供方。</Typography.Text>
        )}

        {probeShown ? (
          <Alert
            key={lastProbed ?? ''}
            type={probeShown.ok ? 'success' : 'error'}
            showIcon
            closable
            message={
              probeShown.ok
                ? `${probeShown.providerId} 可用 · ${probeShown.model} · ${formatLatency(probeShown.latencyMs)}`
                : `${probeShown.providerId} 测试未通过`
            }
            description={
              probeShown.ok ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  模型返回：「{probeShown.reply || '（空）'}」
                </Typography.Text>
              ) : (
                <Typography.Text style={{ fontSize: 12 }}>{probeShown.error}</Typography.Text>
              )
            }
            onClose={() => {
              setProbeResults((prev) => {
                const next = { ...prev }
                if (lastProbed) {
                  delete next[lastProbed]
                }
                return next
              })
              setLastProbed(null)
            }}
          />
        ) : null}

        {data ? <ActiveProviderBanner data={data} busy={switching} onReset={() => void resetActive()} /> : null}

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
