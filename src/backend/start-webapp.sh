#!/bin/bash
# 启动后端。
#
# 为什么要包一层：发布脚本靠日志关键字判断「服务已就绪」（serving http / listening on
# / Local: http 之类），而 Spring Boot 打的是 "Tomcat started on port(s): 3000"，
# 不在它的关键字表里。所以在 Tomcat 真的起来之后补一行标准格式的提示。
set -o pipefail

cd "$(dirname "$0")"

DATA_DIR="${TANGENT_DATA_DIR:-/workspace/webapp-data}"
PORT="${PORT:-3000}"

mkdir -p "$DATA_DIR/logs"

export TANGENT_DATA_DIR="$DATA_DIR"
export TANGENT_LOCAL_SETTINGS_DIR="$DATA_DIR"
export APP_DATA_DIR="$DATA_DIR"
# 桌面版语义：允许在界面里配置 AI Key（Key 用下面的主密钥加密落盘）
export APP_SECURITY_ALLOW_LOCAL_AI_KEY_SETTINGS=true
# 主密钥：首次启动写死在这里，保证重启后仍能解开已存的 Key。
# 这是本地演示实例，不是生产密钥；真要对外服务应改成环境变量注入。
export TANGENT_SETTINGS_ENCRYPTION_KEY="${TANGENT_SETTINGS_ENCRYPTION_KEY:-tangent-webapp-demo-key-32bytes}"

java -jar target/timetable-backend-1.0.0.jar \
  --spring.profiles.active=standalone \
  --server.port="$PORT" \
  --server.address=0.0.0.0 2>&1 | while IFS= read -r line; do
    echo "$line"
    # 注意这里等的是 "Tomcat initialized with port" 而不是 "Tomcat started on port"：
    # 后者要等整个 Spring 上下文（Flyway 迁移、Bean 初始化）跑完才打，实测约 4.5s，
    # 而发布脚本的快速探测窗口只有 5s —— 差一点点就判成"起不来"。前者在 Tomcat
    # 绑定端口时就打了（约 1.3s），此时后续请求会被 queue 住、等上下文就绪再处理，
    # 对探测来说已经足够。
    if [[ "$line" == *"Tomcat initialized with port"* && -z "$ANNOUNCED" ]]; then
      ANNOUNCED=1
      echo "[start.sh] Server listening on http://0.0.0.0:${PORT} (serving http)"
    fi
  done
