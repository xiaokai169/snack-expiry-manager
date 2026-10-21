# 零食效期管家 · 服务器镜像
# 构建：docker compose build
FROM python:3.11-slim-bookworm

ARG PIP_INDEX_URL=https://pypi.org/simple
ARG OMP_NUM_THREADS=4
# Debian 软件源镜像；国内服务器默认使用阿里云，可覆盖为 deb.debian.org
ARG APT_MIRROR=mirrors.aliyun.com

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_INDEX_URL=${PIP_INDEX_URL} \
    OMP_NUM_THREADS=${OMP_NUM_THREADS} \
    HOME=/root

# OpenCV / PaddleOCR 运行所需的系统库
# - 默认切换 Debian 软件源到国内镜像，避免 deb.debian.org 缓慢 / 缓存过期
# - Check-Valid-Until=false 用于绕过镜像站缓存的过期 InRelease
RUN set -eux; \
    for f in /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources; do \
        if [ -f "$f" ]; then \
            sed -i "s|deb.debian.org|${APT_MIRROR}|g; s|security.debian.org|${APT_MIRROR}|g" "$f"; \
        fi; \
    done; \
    apt-get -o Acquire::Check-Valid-Until=false update; \
    apt-get install -y --no-install-recommends \
       libgl1 \
       libglib2.0-0 \
       libgomp1 \
       libsm6 \
       libxext6 \
       libxrender1 \
       libxcb1 \
       libx11-6; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir -r requirements.txt

COPY server.py ./
COPY static ./static

# 模型缓存目录由 docker-compose 挂载持久化
RUN mkdir -p /app/.uploads /root/.paddlex

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python -c "import json,urllib.request; d=json.load(urllib.request.urlopen('http://127.0.0.1:8765/api/health', timeout=8)); raise SystemExit(0 if d.get('ocr_available') else 1)"

CMD ["python", "server.py", "--host", "0.0.0.0", "--port", "8765", "--no-browser"]
