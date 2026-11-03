FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/shared packages/shared
COPY e2e/fake-retailer e2e/fake-retailer
COPY services/worker/src/__tests__/fixtures services/worker/src/__tests__/fixtures
RUN pnpm install --filter @brazier/fake-retailer... --frozen-lockfile=false
WORKDIR /app/e2e/fake-retailer
EXPOSE 4010
CMD ["pnpm", "start"]
