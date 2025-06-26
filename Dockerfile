FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
COPY . .

RUN npm ci && npm install -g pm2
RUN npm run build
RUN npm prune --production

RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001
# RUN chown -R nodejs:nodejs /app
USER 1001

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "http.get('http://localhost:3001/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })" || exit 1

CMD ["pm2-runtime", "start", "dist/app.js", "--name", "slack-mcp"]