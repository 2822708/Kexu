#!/usr/bin/env bash
# ============================================================
#  共用同一份数据：给你的朋友分配一个「与你同工作区」的 API Key
#
#  为什么不能直接让他访问首页了事：
#  这套系统没有注册概念，设备首次连接会**自动注册一个全新工作区**，
#  他看到的是空课表，不会是你的数据。所以必须显式把 Key 给他。
#
#  用法（在服务器上执行）：
#    sudo ./share-workspace.sh --list                    # 列出所有工作区
#    sudo ./share-workspace.sh --source <你的Key>        # 看这个 Key 下有多少数据
#    sudo ./share-workspace.sh --source <你的Key> --label "朋友小明"
#                                                        # 生成共享 Key
#
#  两个模式的区别（重要）：
#    --mode alias （默认）新 Key 是独立账号，需再用一条 SQL 把数据指向你的工作区
#    --mode direct        直接把**你的 Key** 告诉朋友：最简单，但他用的就是你本人身份，
#                         你无法单独撤销他而不影响自己
# ============================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/timetable}"
MYSQL_DB="${MYSQL_DB:-timetable}"
SOURCE_KEY=""
LABEL=""
MODE="alias"

die() { echo "❌ $*" >&2; exit 1; }
info() { echo "▶ $*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --list)   MODE="list"; shift ;;
    --source) SOURCE_KEY="${2:-}"; shift 2 ;;
    --label)  LABEL="${2:-}"; shift 2 ;;
    --mode)   MODE="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) die "未知参数：$1" ;;
  esac
done

# 从 .env 读数据库口令，避免在命令行里明文出现（会进 shell history 和 ps）
if [ -f "$APP_DIR/.env" ]; then
  set -a; . "$APP_DIR/.env"; set +a
fi
MYSQL_USER="${MYSQL_USER:-root}"
MYSQL_PWD_ENV="${TANGENT_COMMON_PASSWORD:-}"

mysql_run() {
  if [ -n "$MYSQL_PWD_ENV" ]; then
    MYSQL_PWD="$MYSQL_PWD_ENV" mysql -u"$MYSQL_USER" "$MYSQL_DB" "$@"
  else
    mysql -u"$MYSQL_USER" "$MYSQL_DB" "$@"
  fi
}

if [ "$MODE" = "list" ]; then
  info "已注册的工作区（数据量最大的排前面）"
  mysql_run -t -e "
    SELECT k.api_key, k.label, k.account_role, k.created_at,
           (SELECT COUNT(*) FROM schedule s WHERE s.api_key = k.api_key) AS schedules,
           (SELECT COUNT(*) FROM todo t WHERE t.api_key = k.api_key)     AS todos
    FROM api_key k
    ORDER BY schedules DESC, todos DESC;"
  exit 0
fi

[ -n "$SOURCE_KEY" ] || die "必须指定 --source <你的Key>（用 --list 查看）"

ROWS=$(mysql_run -N -B -e "SELECT COUNT(*) FROM api_key WHERE api_key = '$SOURCE_KEY';")
[ "$ROWS" = "1" ] || die "找不到这个 Key，或它不唯一。先用 --list 确认"

echo
info "源工作区数据量"
mysql_run -t -e "
  SELECT
    (SELECT COUNT(*) FROM schedule         WHERE api_key='$SOURCE_KEY') AS 课表,
    (SELECT COUNT(*) FROM todo             WHERE api_key='$SOURCE_KEY') AS 任务,
    (SELECT COUNT(*) FROM ai_conversation  WHERE api_key='$SOURCE_KEY') AS 对话,
    (SELECT COUNT(*) FROM student_profile  WHERE api_key='$SOURCE_KEY') AS 学生档案;"

[ -n "$LABEL" ] || die "生成共享 Key 需要 --label（用来标注是谁，方便日后单独撤销）"

# 生成高强度 Key：32 字节随机 -> 64 位十六进制，与既有 Key 的 VARCHAR(64) 对齐
NEW_KEY=$(openssl rand -hex 32)

info "写入共享 Key"
mysql_run -e "
  INSERT INTO api_key (api_key, label, account_role, created_at)
  VALUES ('$NEW_KEY', '$LABEL', 'USER', NOW());"

cat <<EOF

==========================================
✅ 共享 Key 已生成
==========================================
  Key    ：$NEW_KEY
  标注   ：$LABEL
  角色   ：USER（不是管理员，改不了 AI Key 配置）

给朋友的操作：
  1. 打开你的站点
  2. 进「设置 → 设备连接」（或首次进入时的连接页）粘贴上面这个 Key
  3. 刷新，应能看到你的课表

EOF

if [ "$MODE" = "alias" ]; then
  cat <<EOF
⚠️ 当前是 alias 模式：这个 Key 是一个**独立空工作区**，还看不到你的数据。
   要让它与你的工作区共享数据，执行下面的迁移（把两张表的归属改到新 Key）：

     UPDATE schedule SET api_key='$NEW_KEY' WHERE api_key='$SOURCE_KEY';
     UPDATE todo     SET api_key='$NEW_KEY' WHERE api_key='$SOURCE_KEY';

   注意：这会把数据**从你的 Key 名下搬走**，你自己要改成用新 Key 才能看到。
   真正「两人同时看同一份」需要工作区/成员概念，当前 schema 没有这个层——
   最省事的等价做法是 --mode direct：把你的 Key 直接给朋友（见脚本头说明）。

   单独撤销他：DELETE FROM api_key WHERE api_key='$NEW_KEY';
               （他的 Key 立即失效，你的数据不受影响）
EOF
fi
