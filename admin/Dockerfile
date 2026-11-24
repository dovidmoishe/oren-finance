# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /repo/admin
RUN corepack enable
COPY app/components/shell/AnimatedIcons /repo/app/components/shell/AnimatedIcons
COPY admin/package.json admin/pnpm-lock.yaml admin/pnpm-workspace.yaml ./
RUN --mount=type=cache,id=oren-admin-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store
COPY admin/index.html admin/tsconfig.json admin/vite.config.ts admin/postcss.config.mjs ./
COPY admin/src ./src
COPY admin/public ./public
RUN pnpm build

FROM caddy:2.10.2-alpine AS runtime
ENV ADMIN_API_UPSTREAM=oren-api-1:3000
COPY admin/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/admin/dist /srv
EXPOSE 8080
