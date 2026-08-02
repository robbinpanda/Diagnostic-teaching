# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS web-build

WORKDIR /workspace/apps/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web/ ./
RUN npm run build

FROM python:3.11-slim-bookworm AS runtime
ARG INSTALL_SPEECH=0

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONUTF8=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DATABASE_URL=sqlite:////workspace/data/app.db \
    APP_SECRET_PATH=/workspace/data/app-secret.key \
    SESSION_LOG_DIR=/workspace/logs/sessions \
    DESKTOP_WEB_ROOT=/workspace/apps/web/out \
    DIAGNOSTIC_TEACHING_HOST=0.0.0.0 \
    DIAGNOSTIC_TEACHING_PORT=8010

RUN if [ "$INSTALL_SPEECH" = "1" ]; then \
      apt-get update \
      && apt-get install -y --no-install-recommends ffmpeg libgomp1 libsndfile1 \
      && rm -rf /var/lib/apt/lists/*; \
    fi

WORKDIR /workspace/apps/api
COPY apps/api/requirements-core.txt ./
RUN python -m pip install --no-cache-dir -r requirements-core.txt \
    && if [ "$INSTALL_SPEECH" = "1" ]; then \
      python -m pip install --no-cache-dir \
        --index-url https://download.pytorch.org/whl/cpu \
        torch==2.11.0+cpu torchaudio==2.11.0+cpu \
      && python -m pip install --no-cache-dir funasr==1.3.29; \
    fi

COPY apps/api/ ./
COPY --from=web-build /workspace/apps/web/out /workspace/apps/web/out

RUN useradd --create-home --uid 10001 tutor \
    && mkdir -p /workspace/data /workspace/logs/sessions \
    && chown -R tutor:tutor /workspace

USER tutor
EXPOSE 8010
VOLUME ["/workspace/data", "/workspace/logs"]

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=6 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8010/api/health', timeout=2)"

CMD ["python", "desktop_main.py"]
