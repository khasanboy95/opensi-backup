FROM opensi-runtime:0.3.0
WORKDIR /opt/computer
COPY deploy/computer/server.mjs ./server.mjs
COPY deploy/computer/lifecycle.mjs ./lifecycle.mjs
COPY connector/browser-engine.mjs ./browser-engine.mjs
COPY server/browser-workflow.mjs /opt/server/browser-workflow.mjs
COPY server/browser-request-limit.mjs /opt/server/browser-request-limit.mjs
CMD ["node", "server.mjs"]
