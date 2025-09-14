# Use Node.js 18 Alpine base image for smaller size
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy application source code
COPY src ./src
COPY data ./data

# Copy .env file for test deployment (if you prefer this method)
# COPY .env.local .env

# Create a non-root user to run the app
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership of app directory
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Set environment variables for test deployment
# WARNING: Only for testing - never do this in production!
ENV GEMINI_API_KEY="AIzaSyCPgGvi3dquZdKi4cB3GIFUu5rXeIb32D4"
ENV MODEL_NAME="gemini-2.0-flash-exp"
ENV VOICE_NAME="Leda"
ENV SESSION_TIMEOUT="900000"
ENV MAX_SESSIONS="100"
ENV NODE_ENV="production"

# Expose the WebSocket port
# Cloud Run will set PORT env variable
EXPOSE 8080

# Start the application
CMD ["node", "src/index.js"]