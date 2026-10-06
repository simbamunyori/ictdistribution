# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# The Prisma CLI applies migrations before each release starts. It gets its
# own complete install, because copying single packages out of node_modules
# misses their dependencies.
FROM base AS migrate
COPY package-lock.json ./
RUN npm install --no-save --omit=dev --prefix /migrate \
  "prisma@$(node -p "require('./package-lock.json').packages['node_modules/prisma'].version")"

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
# Server commands (scripts/ops.ts) as one file the runner can start with node.
RUN npx esbuild scripts/ops.ts --bundle --platform=node --target=node22 --format=cjs --external:@prisma/client --external:.prisma --outfile=ops.cjs

FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd --system ictd && useradd --system --gid ictd ictd
COPY --from=build /app/public ./public
COPY --from=build --chown=ictd:ictd /app/.next/standalone ./
COPY --from=build --chown=ictd:ictd /app/.next/static ./.next/static
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/ops.cjs ./ops.cjs
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=migrate /migrate/node_modules /migrate/node_modules
USER ictd
EXPOSE 3000
# Migrations run in the "migrate" service before each release (deploy/deploy.sh); applying them here too keeps a lone `docker run` safe.
CMD ["sh", "-c", "node /migrate/node_modules/prisma/build/index.js migrate deploy && node server.js"]
