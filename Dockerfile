FROM node:22-bookworm-slim AS node-base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV COREPACK_HOME=/opt/corepack
WORKDIR /workspace
RUN corepack enable
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/broker-connector/package.json apps/broker-connector/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/validators/package.json packages/validators/package.json
RUN corepack pnpm install --frozen-lockfile
COPY . .
RUN corepack pnpm db:generate

FROM node-base AS api
RUN corepack pnpm --filter api build
EXPOSE 5089
USER node
CMD ["node", "apps/api/dist/main.js"]

FROM node-base AS broker-connector
RUN corepack pnpm --filter broker-connector build
EXPOSE 5092
USER node
CMD ["node", "apps/broker-connector/dist/main.js"]

FROM node-base AS web
ARG NEXT_PUBLIC_API_URL=/api
ARG NEXT_PUBLIC_DATA_MODE=HISTORICAL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_DATA_MODE=$NEXT_PUBLIC_DATA_MODE
RUN corepack pnpm --filter web build
EXPOSE 5088
RUN chown -R node:node apps/web/.next
USER node
CMD ["corepack", "pnpm", "--filter", "web", "start"]
