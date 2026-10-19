# syntax=docker/dockerfile:1
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# docker CLI is required: the worker shells out to `docker run` to sandbox
# each submission in the unsolvable-judge-runtime image (see src/worker.ts).
RUN apk add --no-cache docker-cli
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
CMD ["node", "dist/worker.js"]
