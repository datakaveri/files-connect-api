FROM node:23-slim AS builder

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

RUN npm install -g pnpm
RUN pnpm install

COPY . .
RUN pnpm build


FROM node:23-slim

WORKDIR /app

COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/redoc.html ./

RUN npm install -g pnpm && pnpm install
RUN pnpm add elastic-apm-node

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "-r", "elastic-apm-node/start", "./build/server.js"]
