FROM node:18-alpine

WORKDIR /app

RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

RUN chown -R nodejs:nodejs /app /home

USER 1001

COPY package*.json ./

# Install dependencies and PM2
# https://github.com/keymetrics/docker-pm2/issues/21#issuecomment-315534868
RUN mkdir -p /home/app/.npm-global/bin \
    && npm config set prefix '/home/app/.npm-global' \
    && npm ci \
    && npm install -g pm2

ENV PATH=/home/app/.npm-global/bin:${PATH}

COPY . .

RUN npm run build

RUN pm2 ping

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "http.get('http://localhost:8080/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })" || exit 1

CMD ["pm2-runtime", "start", "dist/app.js", "--name", "slack-mcp"]
