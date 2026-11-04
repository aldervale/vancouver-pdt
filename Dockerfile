FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG COMMIT_SHA=dev
ENV COMMIT_SHA=$COMMIT_SHA
RUN npm run build

# Install from the lockfile independently. Never copy the builder's dev tools.
FROM node:22-alpine AS production-dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY scripts/check-runtime-deps.mjs /tmp/check-runtime-deps.mjs
RUN node /tmp/check-runtime-deps.mjs /app

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Fix the server origin rather than trusting a user-supplied Host header.
ENV ORIGIN=https://bcdaylight.ca
COPY --from=builder /app/build build/
COPY --from=production-dependencies /app/node_modules node_modules/
COPY --from=production-dependencies /app/package*.json ./
EXPOSE 3000
CMD ["node", "build"]
