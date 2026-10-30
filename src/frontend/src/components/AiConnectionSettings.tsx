import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Input,
  Popconfirm,
  Select,
  Space,
  Switch,
  Typography,
  message,
} from 'antd'
import { clearAiSettings, getAiSettings, saveAiSettings, testAiConnection } from '../local/ai'
import {
  AI_PROVIDER_PRESETS,
  CUSTOM_AI_MODEL,
  CUSTOM_AI_PROVIDER,
  aiDraftKey,
  initialAiSelection,
  sameAiEndpoint,
} from '../local/ai/providers'

export default function AiConnectionSettings() {
  const [saved, setSaved] = useState(getAiSettings)
  const [initial] = useState(() => initialAiSelection(saved))
  const [providerId, setProviderId] = useState(initial.providerId)
  const [endpoint, setEndpoint] = useState(initial.endpoint)
  const [model, setModel] = useState(initial.model)
  const [modelChoice, setModelChoice] = useState(initial.modelChoice)
  const [apiKey, setApiKey] = useState('')
  const [enabled, setEnabled] = useState(saved.enabled)
  const [allowContext, setAllowContext] = useState(saved.allowContext)
  const [visionEnabled, setVisionEnabled] = useState(saved.visionEnabled)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const testController = useRef<AbortController | null>(null)
  const provider = AI_PROVIDER_PRESETS.find((item) => item.id === providerId)
  const keepsSavedKey = !!saved.apiKey && sameAiEndpoint(endpoint, saved.endpoint)

  useEffect(() => () => {
    testController.current?.abort()
    testController.current = null
  }, [])

  const chooseProvider = (id: string) => {
    const next = AI_PROVIDER_PRESETS.find((item) => item.id === id)
    setProviderId(id)
    setEndpoint(next?.endpoint ?? '')
    setModel(next?.models[0]?.id ?? '')
    setModelChoice(next?.models[0]?.id ?? CUSTOM_AI_MODEL)
    setApiKey('')
    setAllowContext(false)
    setVisionEnabled(false)
    setResult(null)
  }
  const chooseModel = (id: string) => {
    setModelChoice(id)
    setModel(id === CUSTOM_AI_MODEL ? '' : id)
    setVisionEnabled(false)
    setResult(null)
  }
  const settings = () => {
    if (!endpoint.trim()) throw new Error('请填写当前 AI 服务的完整接口地址')
    if (!model.trim()) throw new Error('请选择模型，或填写其他模型的名称')
    const key = aiDraftKey(endpoint, apiKey, saved)
    if (!key)
      throw new Error(
        '请填写' + (provider ? ' ' + provider.label + ' 的' : '当前服务的') +
        ' API Key；原服务的密钥不会用于其他服务',
      )
    return { endpoint, model, apiKey: key, enabled, allowContext, visionEnabled }
  }
  const save = () => {
    try {
      const next = saveAiSettings(settings())
      setSaved(next)
      setEndpoint(next.endpoint)
      setModel(next.model)
      setApiKey('')
      setResult(null)
      message.success('AI连接设置已保存在此浏览器')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败')
    }
  }
  const test = async () => {
    if (testController.current) return
    const controller = new AbortController()
    testController.current = controller
    setTesting(true)
    setResult(null)
    try {
      const response = await testAiConnection(settings(), controller.signal)
      if (testController.current === controller && !controller.signal.aborted)
        setResult({ ok: true, text: response.message })
    } catch (error) {
      if (testController.current === controller && !controller.signal.aborted)
        setResult({ ok: false, text: error instanceof Error ? error.message : '连接失败' })
    } finally {
      if (testController.current === controller) {
        testController.current = null
        setTesting(false)
      }
    }
  }
  const clear = () => {
    try {
      clearAiSettings()
      const empty = getAiSettings()
      const selection = initialAiSelection(empty)
      setSaved(empty)
      setProviderId(selection.providerId)
      setEndpoint(selection.endpoint)
      setModel(selection.model)
      setModelChoice(selection.modelChoice)
      setApiKey('')
      setEnabled(false)
      setAllowContext(false)
      setVisionEnabled(false)
      setResult(null)
      message.success('已移除此浏览器的AI连接和Key')
    } catch {
      message.error('未能清除浏览器中的AI设置')
    }
  }

  return (
    <div className="ai-connection-form">
      <Typography.Paragraph className="ai-connection-help">
        选择服务和模型，填写该服务的 API Key 即可配置。AI 是可选的联网能力，课表和任务仍可离线使用。
      </Typography.Paragraph>
      <div className="ai-connection-fields">
        <div className="ai-connection-field">
          <label htmlFor="ai-provider">AI 服务</label>
          <Select
            id="ai-provider"
            aria-label="AI服务"
            value={providerId}
            disabled={testing}
            onChange={chooseProvider}
            options={[
              ...AI_PROVIDER_PRESETS.map((item) => ({ value: item.id, label: item.label })),
              { value: CUSTOM_AI_PROVIDER, label: '其他服务（手动填写）' },
            ]}
          />
        </div>
        {provider && (
          <div className="ai-connection-field">
            <label htmlFor="ai-model-choice">模型</label>
            <Select
              id="ai-model-choice"
              aria-label="AI模型"
              value={modelChoice}
              disabled={testing}
              onChange={chooseModel}
              options={[
                ...provider.models.map((item) => ({ value: item.id, label: item.label })),
                { value: CUSTOM_AI_MODEL, label: '其他模型（手动填写）' },
              ]}
            />
          </div>
        )}
        {!provider && (
          <div className="ai-connection-field ai-connection-field-wide">
            <label htmlFor="ai-endpoint">OpenAI 兼容服务地址</label>
            <Input
              id="ai-endpoint"
              aria-label="AI服务地址"
              autoComplete="off"
              placeholder="https://你的推理服务/v1"
              style={{ fontSize: 16 }}
              value={endpoint}
              disabled={testing}
              onChange={(e) => {
                const next = e.target.value
                if (!sameAiEndpoint(next, endpoint)) {
                  setApiKey('')
                  setAllowContext(false)
                  setVisionEnabled(false)
                }
                setEndpoint(next)
                setResult(null)
              }}
            />
          </div>
        )}
        {(!provider || modelChoice === CUSTOM_AI_MODEL) && (
          <div className="ai-connection-field">
            <label htmlFor="ai-custom-model">模型名称</label>
            <Input
              id="ai-custom-model"
              aria-label="AI模型名称"
              autoComplete="off"
              placeholder="填写该服务提供的聊天模型名称"
              style={{ fontSize: 16 }}
              value={model}
              disabled={testing}
              onChange={(e) => {
                setModel(e.target.value)
                setVisionEnabled(false)
                setResult(null)
              }}
            />
          </div>
        )}
        <div className="ai-connection-field ai-connection-field-wide">
          <label htmlFor="ai-api-key">API Key（仅保存在此浏览器）</label>
          <Input.Password
            id="ai-api-key"
            aria-label="AI API Key"
            autoComplete="new-password"
            style={{ fontSize: 16 }}
            placeholder={keepsSavedKey ? '已保存；留空保留，填写则替换' : '填写你在当前服务创建的 API Key'}
            value={apiKey}
            disabled={testing}
            onChange={(e) => {
              setApiKey(e.target.value)
              setResult(null)
            }}
          />
        </div>
      </div>
      {provider && (
        <div className="ai-provider-endpoint">
          <span>接口地址已自动填写</span>
          <Typography.Text copyable>{endpoint}</Typography.Text>
          <div className="ai-provider-links">
            <a href={provider.keyUrl} target="_blank" rel="noopener noreferrer">获取 API Key</a>
            <a href={provider.docsUrl} target="_blank" rel="noopener noreferrer">接口文档</a>
          </div>
          {provider.note && <p className="ai-connection-help">{provider.note}</p>}
        </div>
      )}
      <Checkbox
        checked={allowContext}
        disabled={testing}
        onChange={(e) => { setAllowContext(e.target.checked); setResult(null) }}
      >
        我允许主动发送时，将当前课表、待办及最近对话发给上述服务
      </Checkbox>
      <Checkbox
        checked={visionEnabled}
        disabled={testing}
        onChange={(e) => { setVisionEnabled(e.target.checked); setResult(null) }}
      >
        此模型支持图片；我允许识别截图时把选中的图片发给上述服务
      </Checkbox>
      <Space>
        <Switch
          aria-label="启用AI助手"
          checked={enabled}
          disabled={testing}
          onChange={(value) => { setEnabled(value); setResult(null) }}
        />
        <span>启用AI助手</span>
      </Space>
      <Space wrap className="ai-connection-actions">
        <Button type="primary" onClick={save} disabled={testing}>保存连接</Button>
        <Button onClick={() => void test()} loading={testing}>测试连接（少量调用）</Button>
        <Popconfirm title="移除此浏览器保存的AI服务和Key？聊天历史保留。" onConfirm={clear} disabled={testing}>
          <Button danger disabled={testing || !(saved.apiKey || saved.endpoint || saved.model)}>
            移除连接
          </Button>
        </Popconfirm>
      </Space>
      {result && <Alert role="status" showIcon type={result.ok ? 'success' : 'error'} message={result.text} />}
      <Typography.Paragraph type="secondary" className="ai-connection-help">
        Key 不进入快照，也不会发给快照服务器；清理浏览器数据后需重新填写。请只在可信设备使用。
        服务须允许本站的 CORS 跨域请求（POST、Authorization、Content-Type）及 SSE 流式响应。
        测试只发送固定测试文字，可能产生少量模型费用；不会发送课表内容。
      </Typography.Paragraph>
    </div>
  )
}
