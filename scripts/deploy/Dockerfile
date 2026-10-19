# 大切课程表 · 后端镜像
#
# 单阶段构建：jar 由 `mvn -Pstandalone package` 预先打好，前端 dist 也已复制进 jar，
# 镜像里只做运行。这样 CI 里构建一次、多台机器复用，镜像层也小。
FROM eclipse-temurin:20-jre-jammy

# 时区会影响「今天截止」的判定和提醒时间，必须固定成 Asia/Shanghai，
# 否则容器默认 UTC，早上 8 点前的截止会被算成前一天。
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

WORKDIR /app

# 数据目录单独挂载：H2 文件库、settings.properties、日志都落在这里。
# 不挂出来，容器一重建课程表和配置就全没了。
ENV TANGENT_DATA_DIR=/data \
    TANGENT_LOCAL_SETTINGS_DIR=/data \
    APP_DATA_DIR=/data

RUN mkdir -p /data && \
    useradd --system --uid 10001 --home /app appuser && \
    chown -R appuser:appuser /app /data

COPY --chown=appuser:appuser timetable-backend-1.0.0.jar /app/app.jar

USER appuser
EXPOSE 3000

# 健康检查走 /api/health，Spring 起得慢（Flyway 迁移 + 建表约 5s），
# start-period 给足 60s，避免容器编排把「还没起完」误判成「挂了」。
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["java", "-XX:MaxRAMPercentage=70", "-jar", "/app/app.jar", \
            "--spring.profiles.active=standalone", \
            "--server.port=3000", "--server.address=0.0.0.0"]
