ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS builder

ARG ALPINE_MIRROR=https://mirrors.aliyun.com/alpine
ARG NPM_REGISTRY=https://registry.npmmirror.com

WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/protocol ./packages/protocol
COPY apps/bridge/package.json ./apps/bridge/
COPY apps/gateway/package.json ./apps/gateway/
COPY apps/web ./apps/web

RUN npm config set registry "$NPM_REGISTRY" \
    && npm ci \
    && npm run build -w apps/web

FROM ${NODE_IMAGE}
ARG ALPINE_MIRROR=https://mirrors.aliyun.com/alpine
ARG NPM_REGISTRY=https://registry.npmmirror.com

WORKDIR /app
ENV TZ=Asia/Shanghai \
    NODE_ENV=production

RUN sed -i -E "s#https?://dl-cdn.alpinelinux.org/alpine#${ALPINE_MIRROR%/}#g" /etc/apk/repositories \
    && apk add --no-cache ca-certificates curl tzdata

COPY package.json package-lock.json ./
COPY packages/protocol ./packages/protocol
COPY apps/bridge/package.json ./apps/bridge/
COPY apps/gateway/package.json ./apps/gateway/
COPY apps/web/package.json ./apps/web/

RUN npm config set registry "$NPM_REGISTRY" \
    && npm ci --omit=dev --workspace=apps/bridge --workspace=packages/protocol

COPY apps/bridge/src ./apps/bridge/src
COPY --from=builder /repo/apps/bridge/src/public ./apps/bridge/src/public

EXPOSE 6190 6191 6192 6199
CMD ["npm", "run", "start", "-w", "apps/bridge"]
