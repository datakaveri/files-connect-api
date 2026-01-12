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

RUN npm install -g pnpm && \
    pnpm install 

# Install curl (needed for downloading the agent) 
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# ---- Download Elastic APM Java Agent ----
RUN curl -sSL -o /app/elastic-apm-agent.jar \
    https://repo1.maven.org/maven2/co/elastic/apm/elastic-apm-agent/1.45.0/elastic-apm-agent-1.45.0.jar

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "./build/server.js"]
