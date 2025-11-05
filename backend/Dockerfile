# Secure multi-stage build
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build || npm run compile || echo "no build step"

FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/.env.example ./.env.example
# Create non-root user
RUN useradd -m app && chown -R app:app /app
USER app
EXPOSE 3000
CMD ["node","dist/server.js"]
