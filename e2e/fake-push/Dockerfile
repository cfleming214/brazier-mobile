FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/shared packages/shared
COPY e2e/fake-push e2e/fake-push
RUN pnpm install --filter @drophawk/fake-push... --frozen-lockfile=false
WORKDIR /app/e2e/fake-push
EXPOSE 4020
CMD ["pnpm", "start"]
