import { Alert, Button, Space, Spin, Typography } from 'antd'
import { DesktopOutlined, ReloadOutlined } from '@ant-design/icons'
import { useApp } from '../store/AppContext'
import { useTheme } from '../theme'

export default function DeviceConnectionPage() {
  const { ready, connectionError, reconnect } = useApp()
  const { mode, toggle } = useTheme()
  return (
    <div className="login-wrapper">
      <div className="login-card">
        <div
          className="login-card-header"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <span>大切课程表</span>
          <Button type="text" size="small" onClick={toggle}>
            {mode === 'dark' ? '浅色' : '深色'}
          </Button>
        </div>
        <div className="login-card-body">
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Typography.Title level={4} style={{ margin: 0 }}>
              <DesktopOutlined /> {ready ? '设备连接' : '正在连接本机课程表'}
            </Typography.Title>
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
              <Button
                type="primary"
                block
                icon={<ReloadOutlined />}
                onClick={() => void reconnect()}
              >
                重新连接
              </Button>
            )}
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
              本机指当前浏览器及其用户配置。换浏览器、使用无痕窗口或清除网站数据会进入新的空间。
              已有登录会保留；连接失败时也不会更换你的身份。
            </Typography.Paragraph>
          </Space>
        </div>
      </div>
    </div>
  )
}
