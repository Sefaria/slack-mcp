FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci && npm install -g pm2

COPY . .

RUN npm run build

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "http.get('http://localhost:8080/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })" || exit 1

CMD ["pm2-runtime", "start", "dist/app.js", "--name", "slack-mcp"]
