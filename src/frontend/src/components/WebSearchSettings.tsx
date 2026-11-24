import { useEffect, useRef, useState } from 'react'
import { Button, Input, Space, Typography, message } from 'antd'
import { useLocation } from 'react-router-dom'
import { getAiSettings, subscribeAiSettings } from '../local/ai/settings'
import { getSearchKey, saveSearchKey, searchProviderFor } from '../local/ai/webSearch'

export default function WebSearchSettings() {
  const [configured, setConfigured] = useState(() => Boolean(getSearchKey()))
  const [provider, setProvider] = useState(() => searchProviderFor(getAiSettings().endpoint))
  const [key, setKey] = useState('')
  const { state } = useLocation()
  const section = useRef<HTMLElement>(null)
  const input = useRef<import('antd').InputRef>(null)
  useEffect(() => subscribeAiSettings(() => {
    setProvider(searchProviderFor(getAiSettings().endpoint))
    setConfigured(Boolean(getSearchKey()))
  }), [])
  useEffect(() => {
    if (state?.focusSearchSettings) {
      section.current?.scrollIntoView({ block: 'nearest' })
      input.current?.focus({ preventScroll: true })
    }
  }, [state])
  const save = (remove = false) => {
    try {
      if (!remove && !key.trim()) throw new Error('请填写 Tavily 搜索 Key')
      saveSearchKey(remove ? '' : key)
      setKey('')
      message.success(remove ? '已移除搜索 Key' : '已保存搜索 Key')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '搜索设置保存失败')
    }
  }
  if (provider.id === 'deepseek') {
    return (
      <section ref={section} className="ai-connection-form" aria-label="联网搜索设置">
        <Typography.Title level={4}>联网搜索</Typography.Title>
        <Typography.Paragraph type="secondary">
          DeepSeek 官方搜索使用上方的 API Key。在助手中开启「联网搜索」后，本次查询会发送给 DeepSeek。
          搜索与模型回复分别计费。
        </Typography.Paragraph>
      </section>
    )
  }
  return (
    <section ref={section} className="ai-connection-form" aria-label="联网搜索设置">
      <Typography.Title level={4}>联网搜索</Typography.Title>
      <Typography.Paragraph type="secondary">
        使用 Tavily 查询网页。开启助手输入框上方的「联网搜索」后，本次查询文字会发送给 Tavily，
        搜索摘要交给所选 AI 服务生成回答，并附来源链接。搜索可能消耗 Tavily 额度。
      </Typography.Paragraph>
      <div className="ai-connection-field">
        <label htmlFor="web-search-key">Tavily API Key</label>
        <Input.Password
          ref={input}
          id="web-search-key"
          aria-label="Tavily 搜索 Key"
          autoComplete="new-password"
          style={{ fontSize: 16 }}
          value={key}
          placeholder={configured ? '已保存；填写可替换' : '填写 Tavily API Key'}
          onChange={(event) => setKey(event.target.value)}
        />
      </div>
      <Space wrap>
        <Button onClick={() => save()}>保存搜索设置</Button>
        {configured && <Button onClick={() => save(true)}>移除搜索 Key</Button>}
        <a href="https://app.tavily.com/home" target="_blank" rel="noopener noreferrer">获取搜索 Key</a>
      </Space>
      <Typography.Paragraph type="secondary">
        搜索 Key 保存在本机。发送给搜索服务的内容只有本次查询文字。
      </Typography.Paragraph>
    </section>
  )
}
