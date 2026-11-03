FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY . .
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DB_PATH=/data/splashdesk.db
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
