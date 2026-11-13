# syntax=docker/dockerfile:1

# ---- deps: install every dependency once, from the lockfile ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: compile TypeScript to dist/ ----
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- test: `docker build --target test .` fails if any check fails ----
FROM build AS test
COPY vitest.config.mts ./
COPY tests ./tests
RUN npm run typecheck && npm test

# ---- runtime: production deps + compiled code only, no network needed ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
