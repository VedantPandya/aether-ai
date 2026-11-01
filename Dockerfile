FROM node:24-alpine AS frontend
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY demo-video/film ./demo-video/film
COPY demo-video/source/audio-natural ./demo-video/source/audio-natural
COPY public ./public
ARG APP_BASE_PATH=/
RUN npm run build

FROM python:3.13-slim AS runtime
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && groupadd --gid 10001 aether \
    && useradd --create-home --uid 10001 --gid 10001 aether \
    && mkdir -p /app/.aether \
    && chown aether:aether /app/.aether
COPY backend ./backend
COPY knowledge ./knowledge
COPY --from=frontend /build/dist ./dist
USER aether
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health',timeout=2)"
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
