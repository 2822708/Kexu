import { Alert, Button, Card, Collapse, Divider, Space, Typography } from 'antd'
import { useNavigate } from 'react-router-dom'
import {
  BookOutlined,
  CheckCircleOutlined,
  QuestionCircleOutlined,
  RobotOutlined,
} from '@ant-design/icons'

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
    key: 'memory',
    label: 'AI 记错了怎么办？',
    children:
      '去「设置 → 长期记忆」直接改掉或删除，下次对话就按新内容来。也可以点「归档」让它不再参与 AI 判断但保留记录。同一件事 AI 只会保留一条，说很多遍也不会变多。',
  },
  {
    key: 'profile',
    label: '为什么 AI 不知道我的专业？',
    children:
      '去「设置 → 学生档案」填一次，AI 就会把它放进每次对话的上下文里。不填也能用，只是建议会比较通用。',
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

export default function UserManualPage() {
  const navigate = useNavigate()
  return (
    <>
      <style>{`
        /* 卡片：白底 + 18px 大圆角 + 柔影（覆盖 index.css 的硬朗 4px 直角） */
        .b-manual .ant-card {
          border: none !important;
          border-radius: var(--b-radius) !important;
          box-shadow: var(--b-sh2) !important;
        }
        .b-manual .ant-card-head {
          border-bottom: 1px solid var(--b-line) !important;
          padding: 0 24px !important;
          min-height: 56px !important;
        }
        .b-manual .ant-card-head-title { font-weight: 900; }
        .b-manual .ant-card-head-title .anticon { color: var(--b-green); }
        .b-manual .ant-card-body { padding: 20px 24px !important; }

        /* 章节标题：大圆角色条点缀 + 800 字重 */
        .b-manual-h {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 14px;
        }
        .b-manual-h-bar {
          width: 7px;
          height: 20px;
          border-radius: 99px;
          flex: none;
          box-shadow: var(--b-sh1);
        }

        /* 代码 / 提示块：浅底 + 14px 圆角 */
        .b-manual code {
          background: var(--b-bg-soft);
          border: 1px solid var(--b-line);
          border-radius: var(--b-radius-sm);
          padding: 2px 8px;
          color: var(--b-blue-ink);
          font-weight: 700;
        }

        /* 顶部提示横幅：浅蓝底 + 14px 圆角 */
        .b-manual .ant-alert {
          border-radius: var(--b-radius-sm) !important;
          border: none !important;
          background: var(--b-blue-soft) !important;
        }
        .b-manual .ant-alert .ant-btn {
          border-radius: 99px !important;
          font-weight: 800 !important;
        }
        .b-manual .ant-alert .ant-btn-primary {
          background: var(--b-green) !important;
          color: rgba(255, 255, 255, 0.95) !important;
          border: none !important;
          box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.12) !important;
        }

        /* FAQ 折叠面板：柔和小卡 */
        .b-manual .ant-collapse { background: transparent; }
        .b-manual .ant-collapse-item {
          border-bottom: none;
          background: var(--b-bg-soft);
          border-radius: var(--b-radius-sm);
          margin-bottom: 8px;
          overflow: hidden;
        }
        .b-manual .ant-collapse-item:last-child { margin-bottom: 0; }
        .b-manual .ant-collapse-header {
          font-weight: 800;
          align-items: center;
          border-radius: var(--b-radius-sm);
        }
        .b-manual .ant-collapse-header:hover { background: var(--b-green-soft); }
        .b-manual .ant-collapse-content {
          background: transparent;
          border-top: 1px dashed var(--b-line);
        }
        .b-manual .ant-collapse-content-box { padding-top: 14px; }

        /* 列表符号着色，正文可读性 */
        .b-manual li::marker { color: var(--b-green); font-weight: 900; }
        .b-manual .ant-typography-secondary { color: var(--b-ink-soft); }
      `}</style>
      <div className="manual-page b-manual">
        <Card
          size="small"
          title={
            <Space>
              <BookOutlined />
              <span>大切课程表 · 使用手册</span>
            </Space>
          }
          extra={<span className="b-pill blue">给非技术朋友的白话教程</span>}
        >
          <div className="manual-body">
            {/*
              引导页只在首次进入时自动弹一次，之后就再也找不到了。
              这里留一个常驻入口，想回看「它能做什么 / 不做什么」时随时能翻出来。
            */}
            <Alert
              type="info"
              showIcon
              icon={<RobotOutlined />}
              message="第一次用？先花三分钟看功能说明"
              description={
                <Space direction="vertical" size={6} style={{ display: 'flex' }}>
                  <Text style={{ fontSize: 13 }}>
                    说明页里写清楚了它能帮你做什么，以及它<strong>不会</strong>做什么
                    （比如不会自动翻你的群聊和邮箱）。看完再动手，不容易用错方向。
                  </Text>
                  <Button size="small" type="primary" onClick={() => navigate('/onboarding')}>
                    再看一次功能说明
                  </Button>
                </Space>
              }
            />

            <section>
              <div className="b-manual-h">
                <span className="b-manual-h-bar" style={{ background: 'var(--b-green)' }} />
                <Title level={4} style={{ margin: 0 }}>
                  怎么进入
                </Title>
              </div>
              <Paragraph>在电脑或手机浏览器打开：</Paragraph>
              <Paragraph copyable={{ text: window.location.origin }}>
                <Text code>{window.location.origin}</Text>
              </Paragraph>
              <Paragraph>手机也可以直接用，会自动适配成手机版样式。</Paragraph>
            </section>

            <Divider />

            <section>
              <div className="b-manual-h">
                <span className="b-manual-h-bar" style={{ background: 'var(--b-blue)' }} />
                <Title level={4} style={{ margin: 0 }}>
                  免登录，自动连接本机空间
                </Title>
              </div>
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
              <div className="b-manual-h">
                <span className="b-manual-h-bar" style={{ background: 'var(--b-purple)' }} />
                <Title level={4} style={{ margin: 0 }}>
                  第一次进来先做什么
                </Title>
              </div>
              <Paragraph>自动进入「课表」页后，如果还没有课表，点「新建课表」：</Paragraph>
              <ul>
                <li>课表名称：随便起，比如「大三上学期」。</li>
                <li>开始/结束日期：填这学期第一周周一的日期，和学期最后一天。</li>
                <li>一个账号可以建多个课表，左侧可以切换当前用哪个。</li>
              </ul>
            </section>

            <Divider />

            <section>
              <div className="b-manual-h">
                <span className="b-manual-h-bar" style={{ background: 'var(--b-yellow)' }} />
                <Title level={4} style={{ margin: 0 }}>
                  看课表
                </Title>
              </div>
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
              <div className="b-manual-h">
                <span className="b-manual-h-bar" style={{ background: 'var(--b-green)' }} />
                <Title level={4} style={{ margin: 0 }}>
                  添加 / 修改 / 删除课程
                </Title>
              </div>
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
              <div className="b-manual-h">
                <span className="b-manual-h-bar" style={{ background: 'var(--b-blue)' }} />
                <Title level={4} style={{ margin: 0 }}>
                  <Space>
                    <CheckCircleOutlined />
                    考试记录（期末周用）
                  </Space>
                </Title>
              </div>
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
              <div className="b-manual-h">
                <span className="b-manual-h-bar" style={{ background: 'var(--b-purple)' }} />
                <Title level={4} style={{ margin: 0 }}>
                  待办事项（提醒自己）
                </Title>
              </div>
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
              <div className="b-manual-h">
                <span className="b-manual-h-bar" style={{ background: 'var(--b-yellow)' }} />
                <Title level={4} style={{ margin: 0 }}>
                  快速导入截图、文件和语音
                </Title>
              </div>
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
              <div className="b-manual-h">
                <span className="b-manual-h-bar" style={{ background: 'var(--b-green)' }} />
                <Title level={4} style={{ margin: 0 }}>
                  <Space>
                    <RobotOutlined />
                    AI 助手（用一句话办事）
                  </Space>
                </Title>
              </div>
              <Paragraph>
                可以直接把文件或图片拖进现有输入框。文件在本机提取文字，追加到草稿；图片以小附件显示，
                点击「发送」后才交给已配置的 AI 服务识别，再与文字一起发送。每次最多 4 张图片，每张最多 4 MiB。
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
              <div className="b-manual-h">
                <span className="b-manual-h-bar" style={{ background: 'var(--b-blue)' }} />
                <Title level={4} style={{ margin: 0 }}>
                  <Space>
                    <RobotOutlined />
                    AI 学长（首页、档案、记忆、每日计划）
                  </Space>
                </Title>
              </div>
              <Paragraph>
                除了「用一句话办事」，AI 还能像一个记得住你的学长：认识你的专业和目标，
                记得你说过的事，每天早上帮你把一天排好。
              </Paragraph>

              <Paragraph strong>① 首页：一眼看完今天</Paragraph>
              <ul>
                <li>打开就是首页，会按你的名字打招呼，列出今天的课、今天该推进的任务、48 小时内要交的东西、临近的考试。</li>
                <li>「今日重点」是系统按规则算出来的，不用等 AI，打开就有。</li>
              </ul>

              <Paragraph strong>② 学生档案：先告诉学长你是谁</Paragraph>
              <ul>
                <li>在「设置 → 学生档案」填姓名、学校、专业、年级、当前目标、学习习惯、兴趣和技能。</li>
                <li>填了之后，AI 的回答和每日计划才会贴合你；不填也能用，只是建议会泛一些。</li>
                <li>档案也可以由 AI 从聊天里自动补充，卡片上会标明「AI 学长提炼」还是「手动填写」。</li>
              </ul>

              <Paragraph strong>③ 长期记忆：学长记得你说过的话</Paragraph>
              <ul>
                <li>聊天里提到跨天仍然成立的事（比如「我报了 12 月六级」），AI 会给你一张记忆卡片，确认后记住。</li>
                <li>同一件事说多少遍都只留一条，不会越记越多。</li>
                <li>「设置 → 长期记忆」可以看到全部，能改、能归档（不再参与 AI 上下文）、能彻底删除。</li>
              </ul>

              <Paragraph strong>④ 任务：比待办更像「作业」</Paragraph>
              <ul>
                <li>待办是随手记的小事；任务是作业、实验报告、网课、考试、竞赛这类有类型、有优先级、有截止时间的事。</li>
                <li>在「待办」页可以手动加任务；也可以把作业通知、截图、PDF 拖给 AI，它会抽出任务草稿让你核对，确认后入库。</li>
                <li>状态可以标记：待开始 → 进行中 → 已完成；已完成的不再出现在首页和每日计划里。</li>
              </ul>

              <Paragraph strong>⑤ 每日计划：让学长排一天</Paragraph>
              <ul>
                <li>首页「AI 建议」点「生成今日计划」，学长会按你今天的课、未完成的任务和作息表排出一条时间线，含休息。</li>
                <li>课程时间严格按课表和作息表来，不会瞎编；一天只生成一次，刷新页面不会重新烧掉你的额度。</li>
                <li>生成之后如果你又改了课程、任务或档案，卡片上会出现「可能已过时」，旧计划照常能看；点「重新生成」才会按最新数据重排一次。</li>
              </ul>

              <Paragraph strong>⑥ 今日待阅：把群通知变成卡片</Paragraph>
              <ul>
                <li>
                  看到班委群公告、教务通知、竞赛报名、讲座预告，复制文字或发截图给它，
                  它会提炼成「一句话核心 + 关键时间 + 相关要求」的卡片，放进首页「今日待阅」。
                </li>
                <li>
                  卡片有四个出口：<strong>加入日程</strong>（转成任务）、
                  <strong>一键了解详情</strong>（把报名条件、流程、收益拆开讲）、
                  <strong>稍后提醒</strong>（1–72 小时后再出现）、<strong>忽略</strong>。
                </li>
                <li>
                  原始聊天记录<strong>不会</strong>入库，只保存提炼后的卡片；
                  你忽略得多的来源会自动往后排，但它不会被隐藏。
                </li>
                <li>
                  提炼出来的卡片只是「待阅」，不等于待办——大量通知属于「知道了就行」，
                  全塞进待办反而会淹没真正要做的事。要不要变成待办，由你点「加入日程」决定。
                </li>
              </ul>

              <Paragraph strong>⑦ 首页会随时间变，语音随时可用</Paragraph>
              <ul>
                <li>
                  首页按时间段换配色：早间暖橙、白天清爽蓝白、晚间深色护眼；
                  内容权重也跟着变——早上看今天的课和今天要交的，晚上多给你看明天的安排和当日小结。
                </li>
                <li>
                  右下角浮球和首页「语音新增」都能直接说话转待办；录音途中切页面不会被打断。
                </li>
                <li>
                  临近截止会提前 3 天、1 天、1 小时各提醒一次，每级只弹一次。
                  <strong>提醒只在应用打开时触发，关掉页面不会推送。</strong>
                </li>
              </ul>

              <Paragraph type="secondary">
                以上所有 AI 写操作都要你点「确认执行」才生效，每次写入都会留下记录。
                你不确认，AI 一个字都不会写进数据库。
                如果你在等待确认期间又改了相关数据（比如手动加了条记忆），卡片会变成「已失效」，
                这时重新问一次就能拿到最新提案——避免你按下确认才发现数据已经对不上。
              </Paragraph>
            </section>

            <Divider />

            <section>
              <div className="b-manual-h">
                <span className="b-manual-h-bar" style={{ background: 'var(--b-purple)' }} />
                <Title level={4} style={{ margin: 0 }}>
                  设置
                </Title>
              </div>
              <ul>
                <li>
                  <Text strong>AI 助手（DeepSeek）</Text>
                  ：填入 API Key 后 AI 功能立即可用；未配置时其它功能不受影响。
                </li>
                <li>
                  <Text strong>学生档案</Text>
                  ：姓名、学校、专业、目标等，是 AI 给个性化建议的依据。
                </li>
                <li>
                  <Text strong>长期记忆</Text>
                  ：AI 记住你的地方，可改、可归档、可删除。
                </li>
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
              <div className="b-manual-h">
                <span className="b-manual-h-bar" style={{ background: 'var(--b-yellow)' }} />
                <Title level={4} style={{ margin: 0 }}>
                  <Space>
                    <QuestionCircleOutlined />
                    常见问题
                  </Space>
                </Title>
              </div>
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
    </>
  )
}
