FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.json tsconfig.base.json ./
COPY packages ./packages
COPY services/api ./services/api

RUN pnpm install --frozen-lockfile
RUN pnpm -C packages/shared build
RUN pnpm -C services/api build

FROM node:22-alpine AS runner
WORKDIR /repo
ENV NODE_ENV=production
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.json tsconfig.base.json ./
COPY packages ./packages
COPY services/api/package.json ./services/api/package.json

# Install production deps for the workspace + api
RUN pnpm install --prod --frozen-lockfile

# Copy only built output + runtime assets
COPY --from=build /repo/services/api/dist ./services/api/dist
COPY --from=build /repo/services/api/migrations ./services/api/migrations
COPY services/api/certs/rds-ca-bundle.pem /etc/ssl/certs/rds-ca-bundle.pem

ENV PORT=3000
EXPOSE 3000
CMD ["pnpm", "-C", "services/api", "start"]
    
