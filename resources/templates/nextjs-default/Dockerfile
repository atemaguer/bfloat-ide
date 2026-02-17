# syntax = docker/dockerfile:1

ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-slim AS base

WORKDIR /app
ENV NODE_ENV="production"

# Build stage
FROM base AS build

# Install dependencies (include dev deps for build tools like tailwindcss)
COPY package.json package-lock.json* ./
RUN npm install --include=dev

# Copy source and build
COPY . .
RUN npm run build

# Remove dev dependencies to reduce image size
RUN npm prune --production

# Production stage
FROM base

# Copy built application
COPY --from=build /app /app

EXPOSE 3000

CMD ["npm", "start"]
