FROM node:24-alpine AS web
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --no-audit --no-fund
COPY web ./web
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
WORKDIR /app
COPY --from=web /app/dist ./dist
COPY server ./server
RUN mkdir /app/data /app/backups && chown node:node /app/data /app/backups
USER node
EXPOSE 8080
CMD ["node","server/index.mjs"]
