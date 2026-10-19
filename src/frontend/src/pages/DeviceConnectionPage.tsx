import { Alert, Button, Space, Spin, Typography } from 'antd'
import { DesktopOutlined, ReloadOutlined } from '@ant-design/icons'
import { useApp } from '../store/AppContext'
import { useTheme } from '../theme'

export default function DeviceConnectionPage() {
  const { ready, connectionError, reconnect } = useApp()
  const { mode, toggle } = useTheme()

  // 连接状态三态药丸：等待(黄) / 未连接(红) / 已连接(绿)——仅视觉呈现，不改变任何逻辑
  const statusPill = connectionError ? (
    <span className="b-pill red">
      <span className="b-conn-dot" />
      未连接
    </span>
  ) : ready ? (
    <span className="b-pill green">
      <span className="b-conn-dot" />
      已连接
    </span>
  ) : (
    <span className="b-pill yellow">
      <span className="b-conn-dot" />
      等待连接
    </span>
  )

  return (
    <>
      <style>{`
        .b-conn .login-card {
          border: none;
          border-radius: var(--b-radius);
          box-shadow: var(--b-sh2);
        }
        .b-conn .login-card-header {
          background: linear-gradient(135deg, var(--b-green) 0%, var(--b-green-deep) 100%);
          color: rgba(255, 255, 255, 0.96);
          font-weight: 900;
          box-shadow: var(--b-hi-top), var(--b-thick-bottom);
        }
        .b-conn .ant-alert {
          border-radius: var(--b-radius-sm) !important;
          border: none !important;
          background: var(--b-red-soft) !important;
        }
        .b-conn-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: currentColor;
          flex: none;
        }
      `}</style>
      <div className="login-wrapper b-conn">
        <div className="login-card">
          <div
            className="login-card-header"
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <span>AI 校园助手</span>
            <Button
              type="text"
              size="small"
              onClick={toggle}
              style={{
                color: 'rgba(255, 255, 255, 0.95)',
                background: 'rgba(255, 255, 255, 0.18)',
                borderRadius: 99,
              }}
            >
              {mode === 'dark' ? '浅色' : '深色'}
            </Button>
          </div>
          <div className="login-card-body">
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <Typography.Title level={4} style={{ margin: 0, fontWeight: 800 }}>
                  <DesktopOutlined style={{ color: 'var(--b-green)' }} />{' '}
                  {ready ? '设备连接' : '正在连接本机课程表'}
                </Typography.Title>
                {statusPill}
              </div>
              <Typography.Paragraph style={{ marginBottom: 0 }}>
                首次打开会自动建立本机空间，以后自动进入，无需填写登录密钥。
              </Typography.Paragraph>
              {!ready && (
                <Spin tip="正在恢复已有账户或建立设备连接…">
                  <div style={{ height: 52 }} />
                </Spin>
              )}
              {connectionError && (
                <Alert type="warning" message="暂时无法连接" description={connectionError} showIcon />
              )}
              {ready && (
                <button
                  type="button"
                  className="b-btn-3d"
                  style={{ width: '100%' }}
                  onClick={() => void reconnect()}
                >
                  <ReloadOutlined />
                  重新连接
                </button>
              )}
              <div
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--b-line)',
                  borderRadius: 'var(--b-radius-sm)',
                  boxShadow: 'var(--b-sh1)',
                  padding: '12px 14px',
                }}
              >
                <Typography.Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
                  本机指当前浏览器及其用户配置。换浏览器、使用无痕窗口或清除网站数据会进入新的空间。
                  已有登录会保留；连接失败时也不会更换你的身份。
                </Typography.Paragraph>
              </div>
            </Space>
          </div>
        </div>
      </div>
    </>
  )
}
