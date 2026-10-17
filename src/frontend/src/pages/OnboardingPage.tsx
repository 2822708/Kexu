import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Space, Steps, Tag, Typography } from 'antd'
import {
  BellOutlined,
  CalendarOutlined,
  ImportOutlined,
  MessageOutlined,
  ProfileOutlined,
  RobotOutlined,
} from '@ant-design/icons'

const { Title, Paragraph, Text } = Typography

/**
 * 首次进入的功能说明页（方案第一部分「启动引导页」+ 第二部分「使用指引页」）。
 *
 * <b>这一页刻意写清楚了「不做什么」。</b>
 * 产品最容易在这里过度承诺：吹「自动抓取所有群消息、自动同步教务系统」，
 * 用户试了发现没有，信任就没了。本项目不做自动抓取（合规与可靠性都不允许），
 * 所以这里直说是「你转发给它，它帮你提炼」——降低预期，但说出来的都是真的。
 *
 * 只看一次：localStorage 记 `timetable.onboarded`，用户手册里还有常驻入口。
 *
 * `onDone` 由 App 传入，用来同步「是否已看完」的内存状态。
 * 这里仍然自己写一遍 localStorage——本页也挂在 `/onboarding` 路由下供回看，
 * 那时没有 onDone，得保证自己写完状态也正确。
 */
export default function OnboardingPage({ onDone }: { onDone?: () => void } = {}) {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)

  const finish = (toProfile: boolean) => {
    try {
      localStorage.setItem('timetable.onboarded', '1')
    } catch {
      // localStorage 不可用时降级为「本次会话内不再显示」，不阻断流程
    }
    onDone?.()
    navigate(toProfile ? '/settings' : '/')
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 16px 48px' }}>
      <Space direction="vertical" size={16} style={{ display: 'flex' }}>
        <div>
          <Title level={3} style={{ marginBottom: 4 }}>
            <RobotOutlined /> 欢迎使用 AI 校园助手
          </Title>
          <Text type="secondary">
            它是你的课表 + 待办 + 一个能读懂校园通知的学长。三分钟看完这一页。
          </Text>
        </div>

        <Steps
          current={step}
          size="small"
          onChange={setStep}
          items={[{ title: '能帮你什么' }, { title: '怎么把信息给它' }, { title: '先让它认识你' }]}
        />

        {/* ==================== 第 1 步：价值 ==================== */}
        {step === 0 && (
          <Space direction="vertical" size={12} style={{ display: 'flex' }}>
            <Card size="small" title={<Space><ImportOutlined />信息提炼</Space>}>
              <Paragraph style={{ marginBottom: 8 }}>
                把班委群公告、教务通知、竞赛报名、讲座预告这类信息<strong>转发给助手</strong>，
                它会提炼成「一句话核心 + 关键时间 + 相关要求」的精简卡片，
                放进首页的「今日待阅」，你再决定要不要跟进。
              </Paragraph>
              <Text type="secondary" style={{ fontSize: 12 }}>
                面对几百条群聊消息，它会挑出与你相关的那条，把截止时间、报名要求、
                综测加分规则单独拎出来，不会让闲聊信息干扰你的节奏。
              </Text>
            </Card>

            <Card size="small" title={<Space><CalendarOutlined />日程规划</Space>}>
              <Paragraph style={{ marginBottom: 8 }}>
                结合你的课表和作息，把考试、作业截止、讲座、报名这些事项排进一天里，
                按截止时间自动分档：<strong>今天截止的强制置顶</strong>，
                不会因为你自己标了「低优先级」就被埋掉。
              </Paragraph>
              <Text type="secondary" style={{ fontSize: 12 }}>
                临近截止会提前 3 天、1 天、1 小时三级提醒。
              </Text>
            </Card>

            <Card size="small" title={<Space><BellOutlined />分级提醒</Space>}>
              <Paragraph style={{ marginBottom: 8 }}>
                覆盖网课、考试、作业截止、班会、活动报名这些高频遗忘场景，
                提醒时间和强度都能自己调。不方便打字时用语音直接说，它帮你记成待办。
              </Paragraph>
              <Text type="secondary" style={{ fontSize: 12 }}>
                提醒只在应用打开时触发，关掉页面不会推送。
              </Text>
            </Card>
          </Space>
        )}

        {/* ==================== 第 2 步：怎么用 ==================== */}
        {step === 1 && (
          <Space direction="vertical" size={12} style={{ display: 'flex' }}>
            <Card size="small" title="三种方式把信息交给它">
              <Space direction="vertical" size={10} style={{ display: 'flex' }}>
                <div>
                  <Tag color="blue">1</Tag> <strong>直接转发或粘贴</strong>
                  <div style={{ marginTop: 4 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      把群里看到的重要通知复制进来，点右下角浮球 → 快速导入 → 「存为待阅通知」。
                    </Text>
                  </div>
                </div>
                <div>
                  <Tag color="blue">2</Tag> <strong>发截图</strong>
                  <div style={{ marginTop: 4 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      截图不用手打，它会先识别文字再提炼。识别时图片会经本服务器转发到
                      已配置的模型服务，应用不保存图片。
                    </Text>
                  </div>
                </div>
                <div>
                  <Tag color="blue">3</Tag> <strong>直接说话</strong>
                  <div style={{ marginTop: 4 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      右下角浮球或首页「语音新增」，说完自动转成待办。
                    </Text>
                  </div>
                </div>
              </Space>
            </Card>

            <Card
              size="small"
              title={<Space><MessageOutlined />随时问它</Space>}
            >
              <Paragraph style={{ marginBottom: 0 }}>
                不确定要不要报名、想不出怎么排时间、想让它把一条通知讲透——
                直接问。「一键了解详情」会让它把报名条件、流程、收益、坑都拆给你看。
              </Paragraph>
            </Card>

            {/*
              这一段必须留在引导页里。
              过度承诺是这个产品最容易犯的错：说了「自动抓取」但做不到，
              用户试一次就再也不信了。说清楚边界反而能建立信任。
            */}
            <Card size="small" title="它不会做什么（先说清楚）">
              <Space direction="vertical" size={6}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  · <strong>不会自动翻你的群聊或邮箱。</strong>
                  它需要你主动转发——这是有意为之，自动抓取群消息既不合规也不可靠。
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  · 不会替你做决定。通知转成待办、加入日程，每一步都要你确认。
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  · 不提供天气、食堂拥挤度、快递取件这类外部数据——没有可靠数据源，不假装能查。
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  · 不会「学会」你的偏好并偷偷调整推送。它只知道你明确告诉它的事（档案与记忆）。
                </Text>
              </Space>
            </Card>
          </Space>
        )}

        {/* ==================== 第 3 步：建档 ==================== */}
        {step === 2 && (
          <Space direction="vertical" size={12} style={{ display: 'flex' }}>
            <Card size="small" title={<Space><ProfileOutlined />花三分钟告诉它你是谁</Space>}>
              <Paragraph style={{ marginBottom: 8 }}>
                在设置页填写<strong>学校、专业、年级、未来规划</strong>（保研 / 就业 / 考研）、
                学习习惯。这些信息会进入它的上下文，回答才不会是通用模板。
              </Paragraph>
              <Text type="secondary" style={{ fontSize: 12 }}>
                也可以直接在聊天里说「我是柔性电子专业大二的，打算保研」，
                它会自己记住。随时能在设置页改，改完立即生效。
              </Text>
            </Card>

            <Card size="small" title="接下来">
              <Space direction="vertical" size={6}>
                <Text>· 先去设置页填档案（三分钟）</Text>
                <Text>· 到课表页导入或手动加课</Text>
                <Text>· 把最近一条群公告转发给它试试</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  任何时候都能在侧栏「用户手册」里回看这些说明。
                </Text>
              </Space>
            </Card>
          </Space>
        )}

        <Space wrap>
          {step > 0 && <Button onClick={() => setStep((s) => s - 1)}>上一步</Button>}
          {step < 2 && (
            <Button type="primary" onClick={() => setStep((s) => s + 1)}>
              下一步
            </Button>
          )}
          {step === 2 && (
            <>
              <Button
                type="primary"
                icon={<ProfileOutlined />}
                onClick={() => finish(true)}
              >
                去填写档案
              </Button>
              <Button onClick={() => finish(false)}>先看看首页</Button>
            </>
          )}
          {step < 2 && (
            <Button type="link" onClick={() => finish(false)}>
              跳过
            </Button>
          )}
        </Space>
      </Space>
    </div>
  )
}
