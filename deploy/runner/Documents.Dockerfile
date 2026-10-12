FROM opensi-runtime:0.3.0
USER root
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-writer libreoffice-calc libreoffice-impress fonts-dejavu fonts-liberation fonts-noto-core && rm -rf /var/lib/apt/lists/*
RUN cd /opt/toolchain && npm install --omit=dev markdown-it@14.1.0
COPY deploy/runner/documents.mjs /opt/toolchain/documents.mjs
USER node
