# syntax=docker/dockerfile:1
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ARG VITE_SENTRY_DSN=
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
RUN npm run build

FROM nginx:1.27-alpine AS runtime
ENV TRUSTED_PROXY_CIDR=127.0.0.1/32
ENV TRUSTED_PROXY_HOP_CIDR=127.0.0.1/32
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY trusted-proxy.conf.template /etc/nginx/templates/trusted-proxy.conf.template
EXPOSE 80
