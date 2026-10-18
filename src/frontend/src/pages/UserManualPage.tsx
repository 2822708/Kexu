import { Card, Collapse, Divider, Space, Typography } from 'antd'
import {
  BookOutlined,
  CheckCircleOutlined,
  QuestionCircleOutlined,
  RobotOutlined,
} from '@ant-design/icons'
import { LOCAL_MODE } from '../local/mode'

const { Title, Paragraph, Text } = Typography

const FAQ = [
  {
    key: 'login',
    label: '打开后提示无法连接怎么办？',
    children:
      '检查网络和后端服务，然后点击「重新连接」。连接失败会保留本机身份，不会创建替代账户；若提示原有账户失效，请联系管理员恢复原账户。不要通过清除浏览器数据解决连接问题。',
  },
  {
    key: 'conflict',
    label: '课表格子为什么有的课没显示？',
    children:
      '同一时间段撞了两门课，系统只显示其中一门，并在格子上显示一个警告角标，点开能看到被顶掉的那门。去把时间调整开就好。',
  },
  {
    key: 'weeks',
    label: '周次怎么填不对？',
    children: '先在「上课周次」下面用 1-16 这类格式输入，点「应用」；或直接勾选。带 * 的是当前周。',
  },
  {
    key: 'exam',
    label: '考试怎么没在课表上？',
    children:
      '考试是按日期显示的，要翻到它所在的那一周才能看到（翻页或点「本周」）。如果日期不在学期范围内也可能看不到。',
  },
  {
    key: 'ai',
    label: 'AI 会乱改数据吗？',
    children:
      'AI 先生成「提案卡片」，每条都要你点「确认执行」才会写入。请核对目标课表、影响数量和字段变化；AI 的理解可能有误，不合适时取消或重新生成。',
  },
  {
    key: 'mobile',
    label: '手机上能用吗？',
    children: '能。所有页面都做了手机适配，窄屏会自动调整布局。',
  },
  {
    key: 'data',
    label: '数据安全吗？',
    children:
      '每个本机空间的数据互相独立。身份保存在当前浏览器配置中，同一浏览器配置的使用者会进入同一空间；更换设备或浏览器不会自动同步。已有登录会继续关联原数据。',
  },
]

function LocalUserManual() {
  const address = new URL(import.meta.env.BASE_URL, window.location.origin).href
  return (
    <div className="manual-page">
      <Card
        size="small"
        title={
          <Space>
            <BookOutlined />
            <span>大切课程表 · 本地版使用手册</span>
          </Space>
        }
      >
        <div className="manual-body">
          <section>
            <Title level={4}>先记住这三件事</Title>
            <Paragraph>
              课表、课程、考试、待办、作息与专注记录保存在当前浏览器中，断网仍可查看和编辑。云端只保存你开启备份后的加密快照，并提供应用下载。手机和电脑的数据不会自动合并。
            </Paragraph>
            <Paragraph>访问地址：</Paragraph>
            <Paragraph copyable={{ text: address }}>
              <Text code>{address}</Text>
            </Paragraph>
            <Paragraph>
              请保持使用同一个地址、浏览器和用户配置。换域名、换浏览器或清除网站数据，会进入不同的本地空间；原有资料需要用导出文件或云快照手动恢复。
            </Paragraph>
          </section>
          <Divider />
          <section>
            <Title level={4}>第一次使用与离线安装</Title>
            <ol>
              <li>联网打开应用，进入课表页，点击「新建课表」，填写学期名称和日期范围。</li>
              <li>
                添加课程时填写星期、节次和周次。周次可输入 <Text code>1-16</Text> 或{' '}
                <Text code>1,3,5</Text> 后点击「应用」。
              </li>
              <li>手机默认按天查看；可切换按周视图并左右滑动，也可查看全部课程。</li>
              <li>
                点「安装」，等待提示「离线资源已完整准备」，再从浏览器菜单安装或添加到主屏幕。iPhone
                / iPad 可用 Safari 的「分享 → 添加到主屏幕」。
              </li>
            </ol>
            <Paragraph>
              首次打开与准备离线资源需要联网。准备完成后，核心页面和已保存的数据可离线使用；AI、云备份与应用更新仍需要网络。只创建桌面图标不等于资源已准备完成。
            </Paragraph>
            <Paragraph>
              本地版不需要连接 Java 服务或登录云账号才能读写课表。旧桌面版数据不会自动迁入；旧 H2
              全库备份不能直接在手机恢复。
            </Paragraph>
          </section>
          <Divider />
          <section>
            <Title level={4}>课程、考试、待办与专注</Title>
            <ul>
              <li>
                点击课程卡片或格子可编辑、删除；删除整张课表会连同其课程、考试及考试关联待办一起删除。
              </li>
              <li>
                在「考试管理」填写考试日期与开始、结束时间。每场考试自动关联一条待办，截止时间为考试开始时间。修改考试会同步这条待办，请从考试管理调整。
              </li>
              <li>
                考试结束后，应用打开、回到前台或运行中的定时检查会自动将关联待办完成；关闭应用后不会发送系统通知。
              </li>
              <li>普通待办可单独添加、编辑和勾选完成。「专注」页可标记当天实际安排的课程完成。</li>
              <li>
                循环任务支持每日、每周、每月，按北京时间计算。应用重新打开时每条规则最多补算 5
                期；关闭应用不保证后台定时运行。「脚本文本」只保存文字，不执行、不生成待办。
              </li>
            </ul>
          </section>
          <Divider />
          <section>
            <Title level={4}>保存副本与自动云快照</Title>
            <Paragraph>在「设置 → 本地数据与云快照」中操作：</Paragraph>
            <ol>
              <li>
                无需联网即可点击「导出核心数据文件」，另存一份
                JSON；请确认下载文件已保存。该文件可阅读，应自行保管。
              </li>
              <li>需要云备份时，点击「创建私人云空间」，或导入已有恢复凭证。</li>
              <li>
                点击「另存恢复凭证」并单独保管，勾选已保存后「开启自动备份」。凭证包含云访问权与解密密钥，服务器无法找回遗失的密钥。
              </li>
              <li>
                应用运行期间，编辑会排队自动备份；自动上传最短间隔 5
                分钟，回到前台或网络恢复后补传。可点「立即备份 / 重试」查看结果。
              </li>
            </ol>
            <Paragraph>
              云连接失败不会阻止本地保存。关闭应用后的准时后台上传不受保证；换设备前请查看最近成功备份时间，或手动导出最新文件。
            </Paragraph>
            <Paragraph>
              核心文件和快照包含课表、课程、考试、待办、节次、循环规则与发生记录、专注记录；不包含
              AI 聊天历史、附件、显示偏好或任何密钥。
            </Paragraph>
          </section>
          <Divider />
          <section>
            <Title level={4}>恢复数据必须手动确认</Title>
            <Paragraph>
              选择本地文件，或在「查看云快照」中「下载并预览」。先核对记录数量，再点击「保存恢复点并替换」。这是替换本机核心数据，不是多设备合并；如果预览后又有编辑，需要重新预览。
            </Paragraph>
            <Paragraph>
              替换前会在本机保留核心数据恢复点，可在「本机恢复点」中再次预览恢复。恢复点也保存在当前浏览器中，不能替代另存的文件或云快照。核心恢复不会恢复
              AI 历史或密钥。
            </Paragraph>
          </section>
          <Divider />
          <section>
            <Title level={4}>
              <Space>
                <RobotOutlined />
                AI 是可选的联网助手
              </Space>
            </Title>
            <Paragraph>
              在设置中填写你选择的 OpenAI 兼容服务地址、模型和自己的 API
              Key，确认允许发送必要上下文后保存连接。「测试连接」会发起少量真实调用，可能产生服务费用；AI
              未配置或连接失败时，课表仍可正常离线编辑。
            </Paragraph>
            <ol>
              <li>
                切换到需要操作的课表并新建对应会话。发送时，消息、该课表和必要的待办、最近对话会直接发给你选择的服务；快照云不代理
                AI 请求。
              </li>
              <li>
                文件文字在本机提取；识别截图需明确启用支持图片的模型，选中的图片会发送给该服务。浏览器语音识别可能另用在线服务，首次使用会请求许可。
              </li>
              <li>
                AI
                只生成待确认卡片。核对目标、日期和字段后逐条点「确认执行」；有歧义时补充信息，不要仅因回复说“已完成”就认为数据已经改变。
              </li>
              <li>
                本地相关数据变化、会话切换或提案过期后，旧卡片可能失效，需要重新生成。手机输入回车用于换行，请点发送按钮。
              </li>
            </ol>
            <Paragraph>
              API Key 只保存在此浏览器的 AI
              连接设置中，不进入核心文件或云快照。请勿把密钥、恢复凭证或不需要处理的私人资料放进聊天和导入文件。
            </Paragraph>
          </section>
          <Divider />
          <section>
            <Title level={4}>设置与应用更新</Title>
            <Paragraph>
              本地版可以修改自己的作息时间，字体大小只影响当前设备。看到「有新版本」时，先保存表单并等待
              AI
              请求结束；确认后会先在本机保存核心数据恢复点，再刷新应用，不需要先连上云。未保存的输入不会自动迁移。
            </Paragraph>
            <Paragraph>
              如果提示本地存储不可用，请检查浏览器存储权限并退出无痕窗口，再点击重新打开。不要把清除网站数据作为修复步骤；这会删除当前浏览器中的课表与密钥。
            </Paragraph>
          </section>
        </div>
      </Card>
    </div>
  )
}

export default function UserManualPage() {
  if (LOCAL_MODE) return <LocalUserManual />
  return (
    <div className="manual-page">
      <Card
        size="small"
        title={
          <Space>
            <BookOutlined />
            <span>大切课程表 · 使用手册</span>
          </Space>
        }
        extra={<Text type="secondary">给非技术朋友的白话教程</Text>}
      >
        <div className="manual-body">
          <section>
            <Title level={4}>怎么进入</Title>
            <Paragraph>在电脑或手机浏览器打开：</Paragraph>
            <Paragraph copyable={{ text: window.location.origin }}>
              <Text code>{window.location.origin}</Text>
            </Paragraph>
            <Paragraph>手机也可以直接用，会自动适配成手机版样式。</Paragraph>
          </section>

          <Divider />

          <section>
            <Title level={4}>免登录，自动连接本机空间</Title>
            <Paragraph>
              首次打开自动建立本机空间，以后打开自动进入课表，无需填写登录密钥。
              如果你已登录过，网页或桌面端会优先保留原有账户和数据。右上角显示连接状态。
            </Paragraph>
            <Paragraph>
              这里的「设备」指当前浏览器及其用户配置；不同浏览器、无痕窗口、不同访问地址会有各自的空间。
              清除网站数据会丢失该浏览器的连接身份，下次进入新的空间，原数据不会自动迁移。
              连接失败时请点「重新连接」，不要清除网站数据。
            </Paragraph>
            <Paragraph type="secondary">
              自动连接只用于识别课程表空间。DeepSeek 服务密钥是独立的 AI
              服务配置，仍需由管理员配置；免登录不会自动开通 AI 服务。
              本机连接不会自动上传文件、截图或录音，导入和 AI 执行仍由你确认。
            </Paragraph>
          </section>

          <Divider />

          <section>
            <Title level={4}>第一次进来先做什么</Title>
            <Paragraph>自动进入「课表」页后，如果还没有课表，点「新建课表」：</Paragraph>
            <ul>
              <li>课表名称：随便起，比如「大三上学期」。</li>
              <li>开始/结束日期：填这学期第一周周一的日期，和学期最后一天。</li>
              <li>一个账号可以建多个课表，左侧可以切换当前用哪个。</li>
            </ul>
          </section>

          <Divider />

          <section>
            <Title level={4}>看课表</Title>
            <ul>
              <li>默认「按周」视图，一周 7 天、每天最多 12 节课的格子。</li>
              <li>顶部可以翻页看第几周，点「本周」回到当前周。</li>
              <li>点右上角「全部课程」可按列表看所有课程。</li>
              <li>格子颜色 = 课程颜色，同一门课颜色固定，方便找。</li>
              <li>屏幕不够宽时课表自动变紧凑；手机上可左右滑动看完整网格。</li>
              <li>点格子可修改或删除这门课。</li>
            </ul>
          </section>

          <Divider />

          <section>
            <Title level={4}>添加 / 修改 / 删除课程</Title>
            <Paragraph>
              点「添加课程」填：课程名称、地点、老师、星期几、第几节、上课周次。
            </Paragraph>
            <Paragraph strong>周次快捷输入：</Paragraph>
            <ul>
              <li>
                <Text code>1-16</Text> = 第 1 到 16 周都有课
              </li>
              <li>
                <Text code>1,3,5</Text> = 单周
              </li>
              <li>有「单周」「双周」「仅本周」「全选」按钮，输完点「应用」。</li>
            </ul>
            <Paragraph>
              修改：点课程格子 → 改完保存。删除：点课程格子 → 删除。
              <br />
              批量导入：有教务 HTML 课表可点「导入课表」→ 粘贴 → AI 识别 → 勾选 → 导入。
            </Paragraph>
          </section>

          <Divider />

          <section>
            <Title level={4}>
              <Space>
                <CheckCircleOutlined />
                考试记录（期末周用）
              </Space>
            </Title>
            <Paragraph>
              考试不按课时算，直接填日期和起止时间，适合期末周、四六级、普通话这类考试。
            </Paragraph>
            <ul>
              <li>课表页点「考试管理」→「添加考试」，填名称、日期、起止时间、地点。</li>
              <li>考试会按日期时间在课表上显示一个红色块，块上标名称、起止时间（两行）、地点。</li>
              <li>
                每加一场考试会自动生成一条待办（截止 = 考试开始时间），列表里标红色「考试」；
                考试结束后自动标记完成。
              </li>
            </ul>
          </section>

          <Divider />

          <section>
            <Title level={4}>待办事项（提醒自己）</Title>
            <ul>
              <li>新建待办：写标题 + 选截止时间。</li>
              <li>勾选左边方框 = 标记完成。</li>
              <li>
                每条待办显示页面内倒计时，快到期变色；当前版本不会发送系统通知，关闭页面后不会弹窗。
              </li>
              <li>「循环任务」标签页可按每周/每月规则自动创建待办；这不等于后台通知。</li>
            </ul>
          </section>

          <Divider />

          <section>
            <Title level={4}>快速导入截图、文件和语音</Title>
            <Paragraph>
              页面右下角的导入按钮可接收 TXT、Markdown、CSV、ICS、HTML、PDF、DOCX
              和截图。文本文件在本机提取；PDF 最多 12 页；DOCX 最多 5 MiB。扫描版 PDF
              没有文本层时，请截取要导入的页面。
            </Paragraph>
            <Paragraph>
              截图最多 4 MiB。点击「将截图发送给 AI 识别文字」后，图片会转发到已配置的 DeepSeek
              服务识别，不会存入应用数据库。识别出的文字可在文本框检查和修正。
            </Paragraph>
            <Paragraph>
              语音输入会调用当前浏览器的识别服务；部分浏览器可能把录音发送到在线服务。
              勾选过的许可会在当前浏览器保留，快速导入与 AI 输入框共用；可回到这里取消勾选。
              每次录音仍需主动点击开始，转写结果可以编辑；不支持时可以手动输入。
            </Paragraph>
            <Paragraph>
              点击「转交 AI 助手」会创建绑定当前课表的新会话，并把可编辑提示放进输入框。AI
              解析日期后只生成操作提案；发送消息后仍需逐项核对并点「确认执行」，不会在导入时自动写入。
            </Paragraph>
          </section>

          <Divider />

          <section>
            <Title level={4}>
              <Space>
                <RobotOutlined />
                AI 助手（用一句话办事）
              </Space>
            </Title>
            <Paragraph>
              可以直接把文件或图片拖进现有输入框。文件在本机提取文字，追加到草稿；图片以小附件显示，
              点击「发送」后才交给已配置的 AI 服务识别，再与文字一起发送。每次最多 4
              张图片，每张最多 4 MiB。
              输入框最右侧的小麦克风按钮用于开始或停止语音转写，首次使用会提示语音许可。
            </Paragraph>
            <Paragraph>用一句话让 AI 帮你整理安排，例如：</Paragraph>
            <ul>
              <li>「下周一3-4节加一节形势政策，地点待定」</li>
              <li>「把周三的高数从第3-4节改到第5-6节」</li>
              <li>「删掉周五上午的课，再加一条周三交实验报告的待办」</li>
              <li>「12月16号加一场数据结构期末考试，下午2点到4点」</li>
            </ul>
            <Paragraph strong>步骤：</Paragraph>
            <ol>
              <li>输入想做的事，按发送（Enter 发送，Shift+Enter 换行）。</li>
              <li>AI 回复文字，并给出准备执行的「操作卡片」。</li>
              <li>每条操作都要你点「确认执行」才会真正改动；不想执行点「取消」。</li>
              <li>一次说多件事会生成多张卡片，逐条确认。</li>
            </ol>
            <Paragraph type="secondary">
              每次对话都绑定一个课表（工作空间）。切到别的课表时输入和操作会锁定，防止改错地方。
            </Paragraph>
            <Paragraph type="secondary">
              提案会显示目标课表和影响数量。失效提案需要重新生成。发送后可点「停止」，
              切换对话或离开页面也会停止生成。请求会向 AI 服务发送有限的相关课表、待办和对话上下文，
              请勿在消息中填写密码或其它无需处理的敏感信息。
            </Paragraph>
          </section>

          <Divider />

          <section>
            <Title level={4}>设置</Title>
            <ul>
              <li>
                <Text strong>作息时间表</Text>
                ：全校统一上下课时间，仅供阅读、不可编辑（管理员才能改）。
              </li>
              <li>
                <Text strong>字体大小</Text>
                ：可分别调「全局其它字体」和「课程表字体」，只保存在当前设备。
              </li>
            </ul>
          </section>

          <Divider />

          <section>
            <Title level={4}>
              <Space>
                <QuestionCircleOutlined />
                常见问题
              </Space>
            </Title>
            <Collapse
              items={FAQ}
              size="small"
              style={{ background: 'transparent' }}
              bordered={false}
            />
          </section>

          <Divider />

          <Paragraph type="secondary" style={{ textAlign: 'center' }}>
            有问题随时找管理员反馈 🙂
          </Paragraph>
        </div>
      </Card>
    </div>
  )
}
