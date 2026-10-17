import { ArrowDownOutlined, ArrowUpOutlined, RedoOutlined } from '@ant-design/icons'
import { Button, List, Modal, Switch, Tag, Typography } from 'antd'
import type { TimeOfDay } from '../types'
import {
  DASHBOARD_MODULES,
  isModuleAvailable,
  type DashboardModuleKey,
} from '../hooks/useDashboardModules'
import { TIME_OF_DAY_LABELS } from '../utils/schedule'

const { Text } = Typography

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
        <Button icon={<RedoOutlined />} onClick={onReset}>
          恢复默认
        </Button>
      }
    >
      <Text type="secondary" style={{ fontSize: 12 }}>
        调整顺序或关掉用不上的模块。灰色的是当前时段（{TIME_OF_DAY_LABELS[period]}
        ）不出现的模块，它属于分时设计，不能强行打开。
      </Text>
      <List
        size="small"
        dataSource={order}
        renderItem={(key, index) => {
          const meta = DASHBOARD_MODULES.find((m) => m.key === key)!
          const available = isModuleAvailable(key, period)
          return (
            <List.Item
              style={available ? undefined : { opacity: 0.55 }}
              actions={[
                <Button
                  key="up"
                  size="small"
                  type="text"
                  icon={<ArrowUpOutlined />}
                  disabled={index === 0}
                  onClick={() => onMove(key, -1)}
                />,
                <Button
                  key="down"
                  size="small"
                  type="text"
                  icon={<ArrowDownOutlined />}
                  disabled={index === order.length - 1}
                  onClick={() => onMove(key, 1)}
                />,
                <Switch
                  key="show"
                  size="small"
                  disabled={!available}
                  checked={!hidden.includes(key)}
                  onChange={(checked) => onToggle(key, !checked)}
                />,
              ]}
            >
              <List.Item.Meta
                title={
                  <span style={{ fontSize: 13 }}>
                    {meta.label}
                    {!available && meta.periods && (
                      <Tag style={{ marginInlineStart: 6 }}>
                        仅{meta.periods.map((p) => TIME_OF_DAY_LABELS[p]).join('、')}
                      </Tag>
                    )}
                  </span>
                }
                description={
                  meta.note && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
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
