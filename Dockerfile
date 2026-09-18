# syntax=docker/dockerfile:1

# =============================================================================
# Stage 1: Dependencies
# =============================================================================
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# =============================================================================
# Stage 2: Build
# =============================================================================
FROM node:22-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# No build args: the browser never talks to the database, so nothing about
# it is compiled into the bundle. DATABASE_URL and the other secrets are
# read at runtime.
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# =============================================================================
# Stage 3: Production runtime
# =============================================================================
FROM node:22-alpine AS production
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Run as an unprivileged user: a flaw in the app then cannot write to the
# image or read files it does not own. node:alpine ships a `node` user.
RUN chown node:node /app
USER node

# Next.js standalone output: a self-contained server with only the
# node_modules it actually needs.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next/static ./.next/static

# server.js reads PORT and HOSTNAME; 0.0.0.0 makes it reachable from
# outside the container.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

# The login page needs no database, so this reports the web tier only.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
