FROM node:24-alpine
RUN apk add --no-cache docker-cli
WORKDIR /runner
COPY deploy/runner/broker.mjs ./broker.mjs
COPY deploy/runner/egress.mjs ./egress.mjs
COPY deploy/runner/package-proxy.mjs ./package-proxy.mjs
CMD ["node", "broker.mjs"]
