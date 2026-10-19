import { useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Input,
  Popconfirm,
  Space,
  Switch,
  Typography,
  message,
} from 'antd'
import { clearAiSettings, getAiSettings, saveAiSettings, testAiConnection } from '../local/ai'

export default function AiConnectionSettings() {
  const [saved, setSaved] = useState(getAiSettings)
  const [endpoint, setEndpoint] = useState(saved.endpoint)
  const [model, setModel] = useState(saved.model)
  const [apiKey, setApiKey] = useState('')
  const [enabled, setEnabled] = useState(saved.enabled)
  const [allowContext, setAllowContext] = useState(saved.allowContext)
  const [visionEnabled, setVisionEnabled] = useState(saved.visionEnabled)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const settings = () => ({
    endpoint,
    model,
    apiKey: apiKey || saved.apiKey,
    enabled,
    allowContext,
    visionEnabled,
  })
  const save = () => {
    try {
      setSaved(saveAiSettings(settings()))
      setApiKey('')
      setResult(null)
      message.success('AI连接设置已保存在此浏览器')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败')
    }
  }
  const test = async () => {
    setTesting(true)
    setResult(null)
    try {
      const response = await testAiConnection(settings())
      setResult({ ok: true, text: response.message })
    } catch (error) {
      setResult({ ok: false, text: error instanceof Error ? error.message : '连接失败' })
    } finally {
      setTesting(false)
    }
  }
  const clear = () => {
    try {
      clearAiSettings()
      const empty = getAiSettings()
      setSaved(empty)
      setEndpoint('')
      setModel('')
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
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Typography.Paragraph style={{ marginBottom: 0 }}>
        AI为可选联网能力。点击发送时，消息、当前课表和本机待办的必要上下文直接发往你选择的推理服务；课表离线编辑不依赖AI。云快照服务不代理推理。
      </Typography.Paragraph>
      <label>
        <Typography.Text>OpenAI兼容服务地址</Typography.Text>
        <Input
          aria-label="AI服务地址"
          autoComplete="off"
          placeholder="https://你的推理服务/v1"
          value={endpoint}
          onChange={(e) => {
            setEndpoint(e.target.value)
            setResult(null)
          }}
        />
      </label>
      <label>
        <Typography.Text>模型名称</Typography.Text>
        <Input
          aria-label="AI模型名称"
          autoComplete="off"
          placeholder="填写该服务提供的聊天模型名称"
          value={model}
          onChange={(e) => {
            setModel(e.target.value)
            setResult(null)
          }}
        />
      </label>
      <label>
        <Typography.Text>API Key（仅此浏览器）</Typography.Text>
        <Input.Password
          aria-label="AI API Key"
          autoComplete="new-password"
          placeholder={saved.apiKey ? '已保存；留空保留，填写则替换' : '填写你自己的服务密钥'}
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value)
            setResult(null)
          }}
        />
      </label>
      <Checkbox checked={allowContext} onChange={(e) => setAllowContext(e.target.checked)}>
        我允许在主动发送时，将当前课表、待办及最近对话发送给上述服务
      </Checkbox>
      <Checkbox checked={visionEnabled} onChange={(e) => setVisionEnabled(e.target.checked)}>
        此模型支持图片；我允许主动识别截图时把选中的图片发给上述服务
      </Checkbox>
      <Space>
        <Switch aria-label="启用AI助手" checked={enabled} onChange={setEnabled} />
        <span>启用AI助手</span>
      </Space>
      <Space wrap>
        <Button type="primary" onClick={save} disabled={testing}>
          保存连接
        </Button>
        <Button onClick={() => void test()} loading={testing}>
          测试连接（少量调用）
        </Button>
        <Popconfirm title="移除此浏览器保存的AI服务和Key？聊天历史保留。" onConfirm={clear}>
          <Button danger disabled={testing || !(saved.apiKey || saved.endpoint || saved.model)}>
            移除连接
          </Button>
        </Popconfirm>
      </Space>
      {result && <Alert showIcon type={result.ok ? 'success' : 'error'} message={result.text} />}
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
        Key不进入快照，也不会发送给快照服务器；浏览器清理数据后需重新填写。Key保存在此站点的私有浏览器设置中，同源页面可访问，请仅在可信设备使用。
        服务必须允许本站的CORS跨域请求（POST、Authorization和Content-Type）与SSE。浏览器无法区分CORS、证书、DNS和断网错误，连接测试用于验证当前浏览器实际能否直连。
      </Typography.Paragraph>
    </Space>
  )
}
