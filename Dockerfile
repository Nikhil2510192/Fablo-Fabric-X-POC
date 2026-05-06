# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

RUN addgroup -S fablogroup && \
    adduser -S fablouser -G fablogroup

COPY package*.json ./
RUN npm ci --only=production && \
    npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY templates/ ./templates/
COPY samples/ ./samples/

USER fablouser

ENTRYPOINT ["node"]
CMD ["dist/generate.js"]