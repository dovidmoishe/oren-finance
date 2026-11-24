# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=oren-admin-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store
COPY index.html tsconfig.json vite.config.ts postcss.config.mjs ./
COPY src ./src
COPY public ./public
RUN pnpm build

FROM caddy:2.10.2-alpine AS runtime
ENV ADMIN_API_UPSTREAM=oren-api-1:3000
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 8080
