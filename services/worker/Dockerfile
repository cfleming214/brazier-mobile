FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/shared packages/shared
COPY services/worker services/worker
RUN pnpm install --filter @drophawk/worker... --frozen-lockfile=false --prod=false
WORKDIR /app/services/worker
EXPOSE 8787
CMD ["pnpm", "start"]
