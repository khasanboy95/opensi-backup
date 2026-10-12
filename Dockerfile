FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.mjs ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4580 DATA_DIR=/app/data LOCAL_DEV_AUTH=false
RUN apk add --no-cache ffmpeg
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir -p /app/data && chown node:node /app/data
COPY --from=build /app/dist ./dist
COPY server ./server
USER node
VOLUME /app/data
EXPOSE 4580
CMD ["node", "server/index.mjs"]
