FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY lib ./lib
COPY recording-worker ./recording-worker
RUN npm run recording-worker:build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/recording-worker/dist ./dist
USER node
EXPOSE 3002
CMD ["node", "dist/server.cjs"]
