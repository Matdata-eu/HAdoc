# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY tsconfig.base.json ./
COPY schema schema
COPY server server
COPY web web
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
# git lets HADOC_GIT_COMMIT=1 commit each edit in the data folder.
RUN apk add --no-cache git
ENV NODE_ENV=production \
    HADOC_DATA=/data \
    PORT=8080
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/schema schema
COPY --from=build /app/server/package.json server/
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
COPY --chown=node:node examples/demo-house /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "server/dist/index.js"]
