#!/usr/bin/env bash
# ============================================================
#  一键部署（在**你自己的服务器 / 本机**上执行，不是在沙箱里）
#
#  这个脚本解决的是「沙箱发布的分享链接打不开」之后的落地问题：
#  沙箱本身只作开发环境，实例跑在你自己的机器上才可控。
#
#  两种模式：
#    ./deploy.sh docker     有 Docker 时用（推荐，环境干净、可迁移）
#    ./deploy.sh jar        没 Docker 时直接跑 jar（需要 JDK 17+）
#
#  用法：
#    ./deploy.sh docker                    # 默认 3000 端口，数据放 ./data
#    PORT=8080 ./deploy.sh docker          # 换端口
#    ./deploy.sh jar --key sk-xxx          # 顺便设初始 DeepSeek Key
#    ./deploy.sh stop                      # 停
#
#  数据在哪：./data/timetable.mv.db（课程表、待办全部数据）
#            ./data/settings.properties（界面里配的 AI provider 与 Key，已加密）
#  ⚠️ 备份就是复制整个 ./data 目录。
# ============================================================
set -euo pipefail

cd "$(dirname "$0")"
MODE="${1:-docker}"
shift || true

PORT="${PORT:-3000}"
DATA_DIR="${DATA_DIR:-$(pwd)/data}"
JAR_NAME="timetable-backend-1.0.0.jar"
IMAGE="tangent-timetable:local"
CONTAINER="tangent-timetable"

die()  { echo "❌ $*" >&2; exit 1; }
info() { echo "▶ $*"; }
ok()   { echo "✅ $*"; }

# 主密钥必须固定：换个值，之前加密存下的 AI Key 就全部解不开了。
# 首次运行自动生成并落到 .env，之后一直复用。
ensure_master_key() {
  local env_file=".env"
  if [ -f "$env_file" ] && grep -q '^TANGENT_SETTINGS_ENCRYPTION_KEY=' "$env_file"; then
    # shellcheck disable=SC1091
    . "$env_file"
  else
    local key
    key="$(head -c 48 /dev/urandom | base64 | tr -d '\n=+/' | cut -c1-40)"
    printf 'TANGENT_SETTINGS_ENCRYPTION_KEY=%s\n' "$key" > "$env_file"
    chmod 600 "$env_file"
    TANGENT_SETTINGS_ENCRYPTION_KEY="$key"
    ok "已生成主密钥并写入 .env（别删这个文件，删了已存的 AI Key 就解不开）"
  fi
}

stop_all() {
  if command -v docker >/dev/null 2>&1 && docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    ok "已停止容器 $CONTAINER"
  fi
  # 按端口找 java 进程，不用 pkill -f：那会把执行脚本的 shell 自己也杀掉
  local pid
  for pid in $(ss -ltnp 2>/dev/null | awk -v p=":${PORT}" '$4 ~ p {print}' | grep -oP 'pid=\K[0-9]+' | sort -u); do
    ps -p "$pid" -o args= 2>/dev/null | grep -q "$JAR_NAME" && kill "$pid" && ok "已停止进程 $pid"
  done
}

case "$MODE" in
  stop) stop_all; exit 0 ;;

  docker)
    command -v docker >/dev/null 2>&1 || die "没有 docker。先装 Docker，或改用 ./deploy.sh jar"
    [ -f "$JAR_NAME" ] || die "找不到 $JAR_NAME。先在 src/backend 跑：mvn -Pstandalone package"
    ensure_master_key
    mkdir -p "$DATA_DIR"
    info "构建镜像（第一次要拉基础镜像，约 2-3 分钟）"
    docker build -q -t "$IMAGE" . >/dev/null
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    info "启动容器"
    docker run -d --name "$CONTAINER" \
      --restart unless-stopped \
      -p "${PORT}:3000" \
      -v "$DATA_DIR:/data" \
      -e "TANGENT_SETTINGS_ENCRYPTION_KEY=${TANGENT_SETTINGS_ENCRYPTION_KEY}" \
      -e "APP_SECURITY_ALLOW_LOCAL_AI_KEY_SETTINGS=true" \
      ${DEEPSEEK_API_KEY:+-e DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY"} \
      "$IMAGE" >/dev/null
    ;;

  jar)
    command -v java >/dev/null 2>&1 || die "没有 java。装 JDK 17+ 或改用 ./deploy.sh docker"
    [ -f "$JAR_NAME" ] || die "找不到 $JAR_NAME。先在 src/backend 跑：mvn -Pstandalone package"
    ensure_master_key
    mkdir -p "$DATA_DIR"
    stop_all
    info "后台启动（日志在 $(pwd)/app.log）"
    TANGENT_DATA_DIR="$DATA_DIR" \
    TANGENT_LOCAL_SETTINGS_DIR="$DATA_DIR" \
    APP_DATA_DIR="$DATA_DIR" \
    APP_SECURITY_ALLOW_LOCAL_AI_KEY_SETTINGS=true \
    TANGENT_SETTINGS_ENCRYPTION_KEY="$TANGENT_SETTINGS_ENCRYPTION_KEY" \
    nohup java -jar "$JAR_NAME" \
      --spring.profiles.active=standalone \
      --server.port="$PORT" --server.address=0.0.0.0 > app.log 2>&1 &
    ;;

  *) die "未知模式：$MODE（可选 docker / jar / stop）" ;;
esac

info "等待就绪"
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    ok "已就绪：http://localhost:${PORT}"
    echo
    curl -s "http://127.0.0.1:${PORT}/api/health"; echo
    echo
    echo "数据目录：$DATA_DIR"
    echo "想让手机装上：用 https 访问这个地址（PWA 安装要求 https 或 localhost），"
    echo "             浏览器里选「添加到主屏幕 / 安装应用」。"
    exit 0
  fi
  sleep 1
done
die "等了 60 秒还没起来。看日志：docker logs $CONTAINER   或   tail -50 app.log"
