FROM node:24-bookworm-slim AS builder

WORKDIR /app

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm build

RUN CI=true pnpm prune --prod

FROM node:24-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

# The runtime only needs Node. Removing the bundled package managers keeps
# npm's build/install-only dependency tree out of the production image.
RUN rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx

COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/redoc.html ./

EXPOSE 3000

CMD ["node", "-r", "elastic-apm-node/start.js", "./build/server.js"]
