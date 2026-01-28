FROM node:22-alpine AS build
WORKDIR /repo

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/api ./services/api
COPY packages ./packages

RUN pnpm install --frozen-lockfile
RUN pnpm -C services/api build

FROM node:22-alpine AS runner
WORKDIR /repo
ENV NODE_ENV=production
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/api ./services/api
COPY packages ./packages

RUN pnpm install --prod --frozen-lockfile

ENV PORT=3000
EXPOSE 3000

CMD ["pnpm", "-C", "services/api", "start"]
