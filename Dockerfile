# 零食效期管家 · 服务器镜像
# 构建：docker compose build
FROM python:3.11-slim-bookworm

ARG PIP_INDEX_URL=https://pypi.org/simple
ARG OMP_NUM_THREADS=4

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_INDEX_URL=${PIP_INDEX_URL} \
    OMP_NUM_THREADS=${OMP_NUM_THREADS} \
    HOME=/root

# OpenCV / PaddleOCR 运行所需的系统库
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       libgl1 \
       libglib2.0-0 \
       libgomp1 \
       libsm6 \
       libxext6 \
       libxrender1 \
       libxcb1 \
       libx11-6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir -r requirements.txt

COPY server.py ./
COPY static ./static

# 模型缓存目录由 docker-compose 挂载持久化
RUN mkdir -p /app/.uploads /root/.paddlex

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/api/health', timeout=3)"

CMD ["python", "server.py", "--host", "0.0.0.0", "--port", "8765", "--no-browser"]
