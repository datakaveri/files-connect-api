# Use latest Node 23.x slim with Debian security patches
FROM node:23.3-slim AS builder

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

RUN npm install -g pnpm

RUN pnpm install

COPY . .

RUN pnpm build

FROM node:23.3-slim

WORKDIR /app

COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/redoc.html ./

# Upgrade system packages to pull in patched glibc/gnutls/linux-pam/etc.
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm && \
    pnpm install

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "./build/server.js"]
