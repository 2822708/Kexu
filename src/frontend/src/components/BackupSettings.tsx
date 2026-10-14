import { useEffect, useState } from 'react'
import { Alert, Button, Card, Descriptions, Modal, Space, Table, Typography, message } from 'antd'
import { BASE_URL, getApiKey, request } from '../api/client'

interface BackupInfo {
  name: string
  sizeBytes: number
  createdAt: string
}

interface BackupStatus {
  available: boolean
  retainedCopies: number
  lastSuccess: string | null
  lastError: string | null
  message: string
}

interface BackupPreview {
  name: string
  sha256: string
  createdAt: string
  schemaVersion: string
  databaseFile: string
  databaseBytes: number
  integrityVerified: boolean
  restoreInstructions: string
}

const readableSize = (bytes: number) => bytes < 1024 * 1024
  ? `${(bytes / 1024).toFixed(1)} KB`
  : `${(bytes / (1024 * 1024)).toFixed(1)} MB`

export default function BackupSettings() {
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<BackupPreview | null>(null)

  const load = async () => {
    const state = await request<BackupStatus>('/backups/status')
    setStatus(state)
    setBackups(state.available ? await request<BackupInfo[]>('/backups') : [])
    setError(null)
  }

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const state = await request<BackupStatus>('/backups/status')
        const items = state.available ? await request<BackupInfo[]>('/backups') : []
        if (active) { setStatus(state); setBackups(items) }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : '读取备份失败')
      }
    })()
    return () => { active = false }
  }, [])

  const operate = async (action: () => Promise<void>) => {
    setBusy(true)
    try { await action() }
    catch (e) { message.error(e instanceof Error ? e.message : '备份操作失败') }
    finally { setBusy(false) }
  }

  const create = () => operate(async () => {
    await request<BackupInfo>('/backups', { method: 'POST' })
    await load()
    message.success('数据库备份已完成')
  })

  const inspect = (name: string) => operate(async () => {
    setPreview(await request<BackupPreview>(`/backups/${encodeURIComponent(name)}/preview`))
  })

  const download = (name: string) => operate(async () => {
    const response = await fetch(`${BASE_URL}/backups/${encodeURIComponent(name)}/download`, {
      headers: { 'X-API-Key': getApiKey() ?? '' },
    })
    if (!response.ok) throw new Error(`备份下载失败（HTTP ${response.status}）`)
    const url = URL.createObjectURL(await response.blob())
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  })

  return (
    <Card title="数据库备份与恢复" extra={status?.available && (
      <Button type="primary" loading={busy} onClick={() => void create()}>立即备份</Button>
    )}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {error && <Alert type="error" showIcon message={error} action={
          <Button loading={busy} onClick={() => void operate(load)}>重试</Button>
        } />}
        {status && <Alert type="info" showIcon message={status.message} />}
        {status?.lastError && <Alert type="warning" showIcon message={status.lastError} />}
        {status?.available && <>
          <Typography.Text type="secondary">
            每天自动备份，保留最近 {status.retainedCopies} 份。备份包含全部课表、待办、AI 对话和账号凭据，请保存在自己的设备上。
            Windows 登录保护文件与 DeepSeek 服务密钥需单独迁移。
          </Typography.Text>
          <Table<BackupInfo>
            rowKey="name"
            size="small"
            dataSource={backups}
            pagination={false}
            locale={{ emptyText: '尚无备份，可点击“立即备份”创建第一份' }}
            columns={[
              { title: '备份时间', dataIndex: 'createdAt', render: (value: string) => new Date(value).toLocaleString() },
              { title: '大小', dataIndex: 'sizeBytes', render: readableSize },
              { title: '操作', render: (_, record) => (
                <Space wrap>
                  <Button size="small" disabled={busy} onClick={() => void inspect(record.name)}>恢复前预览</Button>
                  <Button size="small" disabled={busy} onClick={() => void download(record.name)}>下载</Button>
                </Space>
              ) },
            ]}
          />
        </>}
      </Space>
      <Modal title="恢复前预览" open={preview !== null} onCancel={() => setPreview(null)} footer={preview && (
        <Space>
          <Button onClick={() => setPreview(null)}>关闭</Button>
          <Button type="primary" loading={busy} onClick={() => void download(preview.name)}>下载这份备份</Button>
        </Space>
      )} width={720}>
        {preview && <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert type={preview.integrityVerified ? 'success' : 'error'} showIcon
            message={preview.integrityVerified ? '文件完整性校验通过；恢复将在关闭程序后离线执行' : '备份校验失败'} />
          <Descriptions column={1} size="small" bordered items={[
            { key: 'date', label: '备份时间', children: new Date(preview.createdAt).toLocaleString() },
            { key: 'version', label: '数据库版本', children: preview.schemaVersion },
            { key: 'size', label: '数据库大小', children: readableSize(preview.databaseBytes) },
            { key: 'hash', label: 'SHA256', children: <Typography.Text copyable style={{ wordBreak: 'break-all' }}>{preview.sha256}</Typography.Text> },
          ]} />
          <Typography.Paragraph style={{ marginBottom: 0 }}>{preview.restoreInstructions}</Typography.Paragraph>
          <Typography.Text type="secondary">
            恢复会覆盖当前数据，原数据库会保留为安全副本。只恢复你自己创建并妥善保管的备份；完整性校验不证明文件来源可信。
          </Typography.Text>
        </Space>}
      </Modal>
    </Card>
  )
}
