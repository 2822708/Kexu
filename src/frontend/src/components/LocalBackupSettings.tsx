import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Divider,
  Input,
  List,
  Modal,
  Space,
  Tag,
  Typography,
  message,
} from 'antd'
import { readLocalState, subscribeLocalChanges } from '../local/db'
import {
  createLogicalSnapshot,
  parseLogicalSnapshot,
  SNAPSHOT_MAX_BYTES,
} from '../local/snapshots/codec'
import { decryptSnapshot, ENCRYPTED_MAX_BYTES } from '../local/snapshots/crypto'
import { previewRestore, restoreConfirmed, type RestorePreview } from '../local/snapshots/restore'
import {
  deleteCloudSnapshot,
  downloadCloudSnapshot,
  listCloudSnapshots,
  type CloudSnapshotMetadata,
} from '../backup/client'
import {
  createBackupSpace,
  disconnectBackup,
  exportRecoveryCredential,
  importRecoveryCredential,
  runBackup,
  setAutoBackup,
  subscribeBackupStatus,
} from '../backup/coordinator'
import {
  listRestorePointMetadata,
  readRestorePoint,
  readBackupState,
  type BackupState,
  type RestorePointMetadata,
} from '../backup/storage'

const downloadJson = (value: unknown, filename: string) => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
const time = (value: string | null) => (value ? new Date(value).toLocaleString() : '尚无成功备份')
const countLabels = {
  schedules: '课表',
  courses: '课程',
  exams: '考试',
  todos: '待办',
  periods: '节次',
  recurringRules: '循环规则',
  recurringOccurrences: '循环发生记录',
  focusCompletions: '专注记录',
  dayEntries: '日任务安排',
  dailyEvents: '日活动记录',
  dailyReviews: '每日回顾',
}

export default function LocalBackupSettings() {
  const [status, setStatus] = useState<BackupState | null>(null)
  const [revision, setRevision] = useState(0)
  const [datasetId, setDatasetId] = useState('')
  const [storageWarning, setStorageWarning] = useState('')
  const [busy, setBusy] = useState(false)
  const [serverUrl, setServerUrl] = useState(window.location.origin)
  const [credentialSaved, setCredentialSaved] = useState(false)
  const [credentialExported, setCredentialExported] = useState(false)
  const [cloudItems, setCloudItems] = useState<CloudSnapshotMetadata[]>([])
  const [cloudLoaded, setCloudLoaded] = useState(false)
  const [preview, setPreview] = useState<RestorePreview | null>(null)
  const [restorePoints, setRestorePoints] = useState<RestorePointMetadata[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const credentialInput = useRef<HTMLInputElement>(null)
  const refresh = useCallback(async () => {
    const local = await readLocalState()
    setRevision(local.revision)
    setDatasetId(local.datasetId)
    try {
      const [backup, points] = await Promise.all([readBackupState(), listRestorePointMetadata()])
      setStatus(backup)
      setRestorePoints(points)
      setStorageWarning('')
    } catch (error) {
      setStorageWarning(error instanceof Error ? error.message : '本机备份队列暂不可用')
    }
  }, [])
  useEffect(() => {
    const update = () => {
      void refresh().catch(() => {})
    }
    update()
    const stopStatus = subscribeBackupStatus(update)
    const stopLocal = subscribeLocalChanges(update)
    return () => {
      stopStatus()
      stopLocal()
    }
  }, [refresh])
  const execute = async (work: () => Promise<void>) => {
    setBusy(true)
    try {
      await work()
      await refresh()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作未完成')
    } finally {
      setBusy(false)
    }
  }
  const showPreview = async (value: unknown) => {
    setPreview(await previewRestore(value))
  }
  const pending =
    status?.lastDatasetId !== datasetId || (status?.lastBackedUpRevision ?? -1) < revision
  const config = status?.config
  return (
    <Card title="本地数据与云快照" style={{ marginBottom: 16 }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Alert
          type="success"
          showIcon
          message={`主数据保存在这台设备 · 本地修订 ${revision}`}
          description="断网仍可编辑。云端只保存加密快照；下载恢复必须手动确认，不进行多设备自动合并。"
        />
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          核心备份包含课表、课程、考试、待办、节次、循环规则与发生记录、课程参加记录、日任务、日活动和每日回顾（含草稿）。不包含
          AI 历史、附件、偏好或任何密钥。
        </Typography.Paragraph>
        <Space wrap>
          <Button
            loading={busy}
            onClick={() =>
              void execute(async () => {
                const snapshot = createLogicalSnapshot(await readLocalState())
                downloadJson(snapshot, `Tangent-core-${new Date().toISOString().slice(0, 10)}.json`)
                message.success('已生成本地数据文件，请确认文件已保存')
              })
            }
          >
            导出核心数据文件
          </Button>
          <Button disabled={busy} onClick={() => fileInput.current?.click()}>
            选择文件并预览恢复
          </Button>
        </Space>
        <Typography.Text type="secondary">
          本地导出文件为可阅读的 JSON，请自行保管。旧桌面 H2 全库备份不能在此恢复。
        </Typography.Text>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          aria-label="选择核心数据快照文件"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            void execute(async () => {
              if (file.size > ENCRYPTED_MAX_BYTES) throw new Error('快照文件过大')
              const text = await file.text()
              const input = JSON.parse(text) as { format?: string }
              if (input.format === 'tangent-encrypted-snapshot') {
                if (!config) throw new Error('请先导入对应的云恢复凭证')
                await showPreview(await decryptSnapshot(input, config.key))
              } else {
                if (file.size > SNAPSHOT_MAX_BYTES) throw new Error('本地核心快照超过 7 MB')
                await showPreview(parseLogicalSnapshot(text))
              }
            })
          }}
        />
        {restorePoints.length > 0 && (
          <details>
            <summary>本机恢复点（替换前自动保存）</summary>
            <List
              size="small"
              dataSource={restorePoints.slice(0, 10)}
              renderItem={(point) => (
                <List.Item
                  actions={[
                    <Button
                      key="preview"
                      size="small"
                      disabled={busy}
                      onClick={() =>
                        void execute(async () =>
                          showPreview(await readRestorePoint(point.snapshotId)),
                        )
                      }
                    >
                      预览恢复
                    </Button>,
                  ]}
                >
                  <Typography.Text>
                    {time(point.createdAt)} · 修订 {point.revision}
                  </Typography.Text>
                </List.Item>
              )}
            />
          </details>
        )}
        <Divider style={{ margin: '4px 0' }} />
        {storageWarning && (
          <Alert
            type="warning"
            showIcon
            message={storageWarning}
            description="云备份队列或恢复点暂不可用；核心数据仍单独保存在本机主库。"
          />
        )}
        <Space wrap>
          <Typography.Text strong>自动云备份</Typography.Text>
          <Tag color={config?.enabled ? 'green' : 'default'}>
            {config?.enabled
              ? pending
                ? '等待备份'
                : '当前修订已备份'
              : config
                ? '尚未开启'
                : '尚未连接'}
          </Tag>
        </Space>
        {!config ? (
          <>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              首次创建空间后，请另存恢复凭证。服务必须与应用同站部署；新设备导入凭证后可列出快照并手动恢复。
            </Typography.Paragraph>
            <Input
              aria-label="云备份服务站点"
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
              placeholder="https://timetable.example.com"
            />
            <Space wrap>
              <Button
                loading={busy}
                onClick={() =>
                  void execute(async () => {
                    await createBackupSpace(serverUrl)
                    setCredentialSaved(false)
                    setCredentialExported(false)
                    setCloudItems([])
                    setCloudLoaded(false)
                  })
                }
              >
                创建私人云空间
              </Button>
              <Button disabled={busy} onClick={() => credentialInput.current?.click()}>
                导入恢复凭证
              </Button>
            </Space>
          </>
        ) : (
          <>
            <Typography.Text type="secondary">
              云站点：{config.serverUrl} · 最近成功：{time(status?.lastBackupAt ?? null)}
            </Typography.Text>
            {pending && (
              <Typography.Text>
                本地修订 {revision} 等待上传；云端最近修订{' '}
                {status?.lastDatasetId === datasetId ? status.lastBackedUpRevision : '无'}。
              </Typography.Text>
            )}
            {status?.error && (
              <Alert
                type="warning"
                showIcon
                message={status.error}
                description="失败仅影响云备份，本机数据可继续读写。"
              />
            )}
            <Space wrap>
              <Button
                disabled={busy}
                onClick={() =>
                  void execute(async () => {
                    downloadJson(await exportRecoveryCredential(), 'Tangent-private-recovery.json')
                    setCredentialExported(true)
                  })
                }
              >
                另存恢复凭证
              </Button>
              <Button disabled={busy} onClick={() => credentialInput.current?.click()}>
                切换恢复凭证
              </Button>
            </Space>
            {!config.credentialSaved && (
              <>
                <Alert
                  type="info"
                  message="恢复凭证包含解密密钥与云访问权，请单独保管；不要放入 GitHub 或聊天记录。服务器无法找回丢失的密钥。"
                />
                <Checkbox
                  disabled={!credentialExported}
                  checked={credentialSaved}
                  onChange={(event) => setCredentialSaved(event.target.checked)}
                >
                  我已单独保存恢复凭证
                </Checkbox>
              </>
            )}
            <Space wrap>
              <Button
                type={config.enabled ? 'default' : 'primary'}
                disabled={busy || (!config.enabled && !config.credentialSaved && !credentialSaved)}
                onClick={() => void execute(() => setAutoBackup(!config.enabled, credentialSaved))}
              >
                {config.enabled ? '暂停自动备份' : '开启自动备份'}
              </Button>
              <Button
                disabled={busy || !config.enabled}
                onClick={() => void execute(() => runBackup(true))}
              >
                立即备份 / 重试
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void execute(async () => {
                    setCloudItems((await listCloudSnapshots(config)).items)
                    setCloudLoaded(true)
                  })
                }
              >
                查看云快照
              </Button>
            </Space>
            <Typography.Text type="secondary">
              运行时防抖 60 秒，自动上传最短间隔 5
              分钟；回到前台或网络恢复后补传。关闭应用后的准时后台上传不受保证。配额满时需手动清理旧快照。
            </Typography.Text>
            {cloudLoaded && (
              <List
                locale={{ emptyText: '这个私人空间还没有快照' }}
                dataSource={cloudItems}
                renderItem={(item) => (
                  <List.Item style={{ flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      {time(item.createdAt)} · 修订 {item.revision} ·{' '}
                      {(item.size / 1024).toFixed(1)} KB
                    </div>
                    <Space wrap>
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void execute(async () => {
                            await showPreview(
                              await decryptSnapshot(
                                await downloadCloudSnapshot(config, item.snapshotId),
                                config.key,
                              ),
                            )
                          })
                        }
                      >
                        下载并预览
                      </Button>
                      <Button
                        danger
                        disabled={busy}
                        onClick={() =>
                          Modal.confirm({
                            title: '删除此云快照？',
                            content: '只删除所选云端版本，不修改本地课表。',
                            okText: '删除云快照',
                            cancelText: '取消',
                            onOk: () =>
                              execute(async () => {
                                await deleteCloudSnapshot(config, item.snapshotId)
                                setCloudItems((await listCloudSnapshots(config)).items)
                              }),
                          })
                        }
                      >
                        删除
                      </Button>
                    </Space>
                  </List.Item>
                )}
              />
            )}
            <Button
              danger
              disabled={busy}
              onClick={() =>
                Modal.confirm({
                  title: '断开此设备的云备份？',
                  content:
                    '将清除此设备保存的云凭据和重试队列，保留本地课表和云端快照。请确认恢复凭证已经另存。',
                  okText: '断开云备份',
                  cancelText: '取消',
                  onOk: () =>
                    execute(async () => {
                      await disconnectBackup()
                      setCloudItems([])
                      setCloudLoaded(false)
                      setCredentialExported(false)
                      setCredentialSaved(false)
                    }),
                })
              }
            >
              断开云备份
            </Button>
          </>
        )}
        <input
          ref={credentialInput}
          type="file"
          accept=".json,application/json"
          hidden
          aria-label="导入私人云恢复凭证"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            void execute(async () => {
              if (file.size > 8192) throw new Error('恢复凭证文件过大')
              await importRecoveryCredential(JSON.parse(await file.text()))
              setCredentialSaved(false)
              setCredentialExported(false)
              setCloudItems([])
              setCloudLoaded(false)
              message.success('已导入凭证；云快照需要单独预览并确认恢复')
            })
          }}
        />
      </Space>
      <Modal
        open={!!preview}
        title="确认恢复核心数据"
        okText="保存恢复点并替换"
        okButtonProps={{ danger: true, loading: busy }}
        cancelText="保留当前数据"
        onCancel={() => !busy && setPreview(null)}
        onOk={() => {
          if (!preview) return
          void execute(async () => {
            await restoreConfirmed(preview)
            setPreview(null)
            message.success('已恢复到本机；恢复前的数据已留存为本机恢复点')
          })
        }}
      >
        {preview && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Typography.Text>
              来源：{time(preview.snapshot.createdAt)} · 修订 {preview.snapshot.source.revision} ·
              快照 v{preview.snapshot.version}
            </Typography.Text>
            <Typography.Paragraph>
              {Object.entries(preview.counts)
                .map(([key, count]) => `${countLabels[key as keyof typeof countLabels]} ${count}`)
                .join('，')}
            </Typography.Paragraph>
            {preview.snapshot.version === 1 && (
              <Alert
                type="warning"
                showIcon
                message="这是一份旧版 v1 快照，没有日任务、活动记录或每日回顾。"
                description="恢复后这些日记录将为空；旧待办的完成状态会保留，但不会补造完成日期或评价。当前日记录会先随全部核心数据保存为本机恢复点。"
              />
            )}
            <Alert
              type="warning"
              showIcon
              message="将替换全部核心业务数据，并清空当前 AI 聊天，防止旧提案误关联。偏好、设备身份及云凭据保留。"
              description="先保存本机恢复点，再执行单个事务替换；预览期间有新编辑则停止恢复并要求重新预览。"
            />
          </Space>
        )}
      </Modal>
    </Card>
  )
}
