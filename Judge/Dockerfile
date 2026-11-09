# syntax=docker/dockerfile:1
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build && rm -f dist/*.test.js

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
ENV JUDGE_HEARTBEAT_FILE=/tmp/judge-heartbeat
USER node
# 성공한 API heartbeat(10초 주기)가 2분 넘게 없으면 멈춘 워커로 보고 종료합니다.
# Compose는 unhealthy만으로 재시작하지 않으므로 프로세스를 끝내 restart 정책이 다시 띄우게 합니다.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD test -e "$JUDGE_HEARTBEAT_FILE" && { test -n "$(find "$JUDGE_HEARTBEAT_FILE" -mmin -2)" || { pkill -KILL -x node; exit 1; }; }
CMD ["node", "dist/worker.js"]
