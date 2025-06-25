# Use Node.js LTS version
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies and PM2
# https://github.com/keymetrics/docker-pm2/issues/21#issuecomment-315534868
RUN mkdir -p /home/app/.npm-global/bin \
    && npm config set prefix '/home/app/.npm-global' \
    && npm ci \
    && npm install -g pm2

ENV PATH=/home/app/.npm-global/bin:${PATH}

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Change ownership of the app directory
RUN chown -R nodejs:nodejs /app

# Switch to user 1001 and initialize PM2
USER 1001
RUN pm2 ping

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "http.get('http://localhost:8080/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })" || exit 1

# Start with PM2
CMD ["pm2-runtime", "start", "dist/app.js", "--name", "slack-mcp"]
