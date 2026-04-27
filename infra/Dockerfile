FROM node:20-slim AS builder

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

RUN npm install -g pnpm

RUN pnpm install

COPY . .

RUN pnpm build

FROM node:20-slim

WORKDIR /app

COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/redoc.html ./

RUN npm install -g pnpm && \
    pnpm install 

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "./build/server.js"]
