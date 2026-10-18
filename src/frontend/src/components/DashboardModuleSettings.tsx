import { ArrowDownOutlined, ArrowUpOutlined, RedoOutlined } from '@ant-design/icons'
import { List, Modal, Switch, Typography } from 'antd'
import type { TimeOfDay } from '../types'
import {
  DASHBOARD_MODULES,
  isModuleAvailable,
  type DashboardModuleKey,
} from '../hooks/useDashboardModules'
import { TIME_OF_DAY_LABELS } from '../utils/schedule'

const { Text } = Typography

const NEUTRAL_PILL_STYLE = { background: 'var(--b-bg-soft)', color: 'var(--b-ink-faint)' } as const

interface Props {
  open: boolean
  period: TimeOfDay
  order: DashboardModuleKey[]
  hidden: DashboardModuleKey[]
  onMove: (key: DashboardModuleKey, delta: number) => void
  onToggle: (key: DashboardModuleKey, hidden: boolean) => void
  onReset: () => void
  onClose: () => void
}

/**
 * 首页模块排序 / 显隐。
 *
 * 用上下箭头而不是拖拽：项目里没有引拖拽库，为这一个弹窗加一个依赖不划算；
 * 八个模块的列表，点两下箭头比拖准。
 *
 * 当前时段不出现的模块，开关是禁用的——勾了也不会生效的开关比没有开关更让人困惑。
 */
export default function DashboardModuleSettings({
  open,
  period,
  order,
  hidden,
  onMove,
  onToggle,
  onReset,
  onClose,
}: Props) {
  return (
    <Modal
      title="自定义首页模块"
      open={open}
      onCancel={onClose}
      footer={
        /* 恢复默认：3D 按钮（原生 button 避开旧 !important 规则） */
        <button
          type="button"
          className="b-btn-3d"
          onClick={onReset}
          style={{ fontSize: 13.5, padding: '7px 18px' }}
        >
          <RedoOutlined />
          恢复默认
        </button>
      }
    >
      <Text type="secondary" style={{ fontSize: 12, color: 'var(--b-ink-soft)' }}>
        调整顺序或关掉用不上的模块。灰色的是当前时段（{TIME_OF_DAY_LABELS[period]}
        ）不出现的模块，它属于分时设计，不能强行打开。
      </Text>
      <List
        size="small"
        dataSource={order}
        style={{
          marginTop: 10,
          background: 'var(--b-bg-soft)',
          borderRadius: 'var(--b-radius)',
          padding: 6,
        }}
        renderItem={(key, index) => {
          const meta = DASHBOARD_MODULES.find((m) => m.key === key)!
          const available = isModuleAvailable(key, period)
          const shown = !hidden.includes(key)
          return (
            <List.Item
              style={{
                padding: '10px 12px',
                margin: '4px 0',
                borderRadius: 'var(--b-radius-sm)',
                background: 'var(--bg-card)',
                boxShadow: 'var(--b-sh1)',
                borderBottom: 'none',
                opacity: available ? undefined : 0.55,
              }}
              actions={[
                <button
                  key="up"
                  type="button"
                  aria-label="上移"
                  disabled={index === 0}
                  onClick={() => onMove(key, -1)}
                  style={{
                    border: 'none',
                    background: 'none',
                    cursor: index === 0 ? 'not-allowed' : 'pointer',
                    padding: 4,
                    color: 'var(--b-blue-ink)',
                    opacity: index === 0 ? 0.35 : 1,
                  }}
                >
                  <ArrowUpOutlined />
                </button>,
                <button
                  key="down"
                  type="button"
                  aria-label="下移"
                  disabled={index === order.length - 1}
                  onClick={() => onMove(key, 1)}
                  style={{
                    border: 'none',
                    background: 'none',
                    cursor: index === order.length - 1 ? 'not-allowed' : 'pointer',
                    padding: 4,
                    color: 'var(--b-blue-ink)',
                    opacity: index === order.length - 1 ? 0.35 : 1,
                  }}
                >
                  <ArrowDownOutlined />
                </button>,
                <Switch
                  key="show"
                  size="small"
                  disabled={!available}
                  checked={shown}
                  onChange={(checked) => onToggle(key, !checked)}
                />,
              ]}
            >
              <List.Item.Meta
                avatar={
                  /* 序号色点：显示中=绿，已关闭=灰 */
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 99,
                      background: shown ? 'var(--b-green)' : 'var(--b-ink-faint)',
                      boxShadow: 'var(--b-sh1)',
                      flex: 'none',
                    }}
                  />
                }
                title={
                  <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--b-ink)' }}>
                    {meta.label}
                    {shown ? (
                      <span className="b-pill green" style={{ marginInlineStart: 6 }}>
                        显示中
                      </span>
                    ) : (
                      <span className="b-pill" style={{ ...NEUTRAL_PILL_STYLE, marginInlineStart: 6 }}>
                        已关闭
                      </span>
                    )}
                    {!available && meta.periods && (
                      <span className="b-pill yellow" style={{ marginInlineStart: 6 }}>
                        仅{meta.periods.map((p) => TIME_OF_DAY_LABELS[p]).join('、')}
                      </span>
                    )}
                  </span>
                }
                description={
                  meta.note && (
                    <Text type="secondary" style={{ fontSize: 12, color: 'var(--b-ink-faint)' }}>
                      {meta.note}
                    </Text>
                  )
                }
              />
            </List.Item>
          )
        }}
      />
    </Modal>
  )
}
