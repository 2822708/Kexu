#!/usr/bin/env bash
# ============================================================
#  给朋友开通服务器权限（在**你的服务器上**执行，不是在沙箱里）
#
#  设计原则：默认最小权限。人只拿到「看日志 + 重启服务」，
#  拿不到 root，也读不到 .env 里的数据库密码和 AI Key。
#
#  用法：
#    sudo ./grant-server-access.sh --user friend --ssh-key 'ssh-ed25519 AAAA...'
#    sudo ./grant-server-access.sh --user friend --ssh-key-file /tmp/friend.pub
#    sudo ./grant-server-access.sh --user friend --ssh-key '...' --level read
#    sudo ./grant-server-access.sh --user friend --revoke          # 撤销
#
#  权限档位（--level）：
#    read    （默认）看日志、看服务状态。几乎零风险
#    restart read + 重启/停止单个服务。用 sudoers 白名单限定到具体命令
#    root    完整 sudo。**风险最高，需显式 --i-understand-the-risk**
# ============================================================
set -euo pipefail

SERVICE="timetable-backend"
APP_DIR="${APP_DIR:-/opt/timetable}"   # 按实际部署路径改，或 export APP_DIR=
LEVEL="read"
SSH_KEY=""
SSH_KEY_FILE=""
TARGET_USER=""
REVOKE=0
RISK_ACK=0

die() { echo "❌ $*" >&2; exit 1; }
info() { echo "▶ $*"; }
ok() { echo "✅ $*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --user)              TARGET_USER="${2:-}"; shift 2 ;;
    --ssh-key)           SSH_KEY="${2:-}"; shift 2 ;;
    --ssh-key-file)      SSH_KEY_FILE="${2:-}"; shift 2 ;;
    --level)             LEVEL="${2:-}"; shift 2 ;;
    --revoke)            REVOKE=1; shift ;;
    --i-understand-the-risk) RISK_ACK=1; shift ;;
    -h|--help)           sed -n '2,22p' "$0"; exit 0 ;;
    *) die "未知参数：$1（用 --help 看用法）" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "需要 root 权限运行：sudo $0 ..."
[ -n "$TARGET_USER" ] || die "必须指定 --user（要授权给谁）"
case "$LEVEL" in read|restart|root) ;; *) die "--level 只能是 read / restart / root" ;; esac
if [ "$LEVEL" = "root" ] && [ "$RISK_ACK" -ne 1 ]; then
  die "root 档位会让对方读到 .env 里的数据库密码和 AI Key，也能删你的数据。
   确认无误请加 --i-understand-the-risk 再执行。"
fi

SUDOERS_FILE="/etc/sudoers.d/${TARGET_USER}-timetable"

# ---------- 撤销 ----------
if [ "$REVOKE" -eq 1 ]; then
  info "撤销 $TARGET_USER 的全部授权"
  if id "$TARGET_USER" >/dev/null 2>&1; then
    deluser "$TARGET_USER" systemd-journal 2>/dev/null || true
    deluser "$TARGET_USER" sudo 2>/dev/null || true
    # sshd 相关组也要摘掉，否则密钥仍能登录
    deluser "$TARGET_USER" ssh 2>/dev/null || true
    rm -rf "/home/$TARGET_USER/.ssh/authorized_keys"
  fi
  rm -f "$SUDOERS_FILE"
  # 账号本身不删（可能还有文件归属），只锁掉登录
  if id "$TARGET_USER" >/dev/null 2>&1; then
    usermod -L -s /usr/sbin/nologin "$TARGET_USER" 2>/dev/null || true
    ok "账号已锁定（未删除，避免破坏文件归属）。要彻底删除：userdel -r $TARGET_USER"
  fi
  ok "撤销完成"
  exit 0
fi

# ---------- 建账号 ----------
if id "$TARGET_USER" >/dev/null 2>&1; then
  info "账号 $TARGET_USER 已存在，跳过创建"
else
  info "创建账号 $TARGET_USER"
  # --disabled-password：不给密码，只允许密钥登录（密码是弱认证，网上暴露的服务器尤其危险）
  adduser --disabled-password --gecos "" "$TARGET_USER"
fi

# ---------- 安装公钥 ----------
[ -n "$SSH_KEY_FILE" ] && SSH_KEY="$(cat "$SSH_KEY_FILE")"
SSH_KEY="$(echo "$SSH_KEY" | tr -d '\r\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
if [ -n "$SSH_KEY" ]; then
  case "$SSH_KEY" in
    ssh-ed25519\ *|ssh-rsa\ *|ecdsa-sha2-*\ *) ;;
    *) die "公钥格式不像 SSH 公钥（应以 ssh-ed25519 / ssh-rsa 开头）：$SSH_KEY" ;;
  esac
  info "安装公钥"
  install -d -m 700 -o "$TARGET_USER" -g "$TARGET_USER" "/home/$TARGET_USER/.ssh"
  AUTH_KEYS="/home/$TARGET_USER/.ssh/authorized_keys"
  touch "$AUTH_KEYS"
  # 去重后追加，避免重复执行把同一把钥匙加好几遍
  if grep -qF "$SSH_KEY" "$AUTH_KEYS" 2>/dev/null; then
    info "公钥已存在，未重复添加"
  else
    echo "$SSH_KEY" >> "$AUTH_KEYS"
  fi
  chown "$TARGET_USER:$TARGET_USER" "$AUTH_KEYS"
  chmod 600 "$AUTH_KEYS"
  ok "公钥已安装"
else
  info "未提供公钥（--ssh-key / --ssh-key-file），跳过。对方将无法登录，除非另有密钥"
fi

# ---------- 授权 ----------
case "$LEVEL" in
  read)
    info "授权档位 read：仅查看日志与服务状态"
    usermod -aG systemd-journal "$TARGET_USER"
    # 用正确的方式判断服务是否存活，别让对方用 ps 全量翻别人的进程
    cat > "$SUDOERS_FILE" <<EOF
# 由 grant-server-access.sh 生成，撤销：删除本文件即可
$TARGET_USER ALL=(root) NOPASSWD: /bin/systemctl status $SERVICE, /usr/bin/systemctl status $SERVICE
EOF
    ;;
  restart)
    info "授权档位 restart：查看 + 重启/停止 $SERVICE"
    usermod -aG systemd-journal "$TARGET_USER"
    cat > "$SUDOERS_FILE" <<EOF
# 由 grant-server-access.sh 生成，撤销：删除本文件即可
$TARGET_USER ALL=(root) NOPASSWD: /bin/systemctl status $SERVICE, /usr/bin/systemctl status $SERVICE
$TARGET_USER ALL=(root) NOPASSWD: /bin/systemctl restart $SERVICE, /usr/bin/systemctl restart $SERVICE
$TARGET_USER ALL=(root) NOPASSWD: /bin/systemctl stop $SERVICE, /usr/bin/systemctl stop $SERVICE
$TARGET_USER ALL=(root) NOPASSWD: /bin/systemctl start $SERVICE, /usr/bin/systemctl start $SERVICE
EOF
    ;;
  root)
    info "授权档位 root：完整 sudo"
    usermod -aG sudo "$TARGET_USER"
    ;;
esac

if [ -f "$SUDOERS_FILE" ]; then
  chmod 440 "$SUDOERS_FILE"
  # 语法错了会导致 sudo 全面失效，必须先校验
  if ! visudo -cf "$SUDOERS_FILE" >/dev/null 2>&1; then
    rm -f "$SUDOERS_FILE"
    die "sudoers 语法校验失败，已回滚删除。请检查 systemd 路径（which systemctl）"
  fi
fi

# ---------- 收紧密钥文件权限 ----------
if [ -f "$APP_DIR/.env" ]; then
  info "收紧 $APP_DIR/.env 权限（含数据库密码与 AI Key）"
  chmod 600 "$APP_DIR/.env"
  ok ".env 现在仅所有者可读"
else
  info "未找到 $APP_DIR/.env（用 APP_DIR=... 指定实际路径），跳过权限收紧"
fi

# ---------- 给出验证方式 ----------
cat <<EOF

==========================================
✅ 授权完成：$TARGET_USER / 档位 $LEVEL
==========================================
让对方在自己电脑上验证：

  ssh $TARGET_USER@你的服务器IP
  sudo systemctl status $SERVICE      # read/restart 档位可用
  journalctl -u $SERVICE -n 50        # 看最近 50 行日志

注意：
  * 组权限变更要**重新登录**才生效（已登录的会话看不到新组）
  * 撤销：sudo $0 --user $TARGET_USER --revoke
  * SSH 加固（强烈建议）：/etc/ssh/sshd_config 设
        PasswordAuthentication no
        PermitRootLogin no
    改完 systemctl reload sshd。先确认自己的密钥能登录，别把自己锁在外面
EOF
