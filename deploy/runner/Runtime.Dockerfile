FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium git python3 python3-venv ca-certificates build-essential golang-go default-jdk-headless php-cli ruby perl lua5.4 sqlite3 unzip && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/python && /opt/python/bin/pip install --no-cache-dir requests flask fastapi uvicorn python-telegram-bot openpyxl python-docx pillow pandas numpy
WORKDIR /opt/toolchain
RUN npm init -y && npm install --save-exact vite@7.1.0 typescript@5.9.3 react@19.2.0 react-dom@19.2.0 @vitejs/plugin-react@5.0.0 lucide-react@0.468.0 playwright-core@1.56.1 express telegraf discord.js axios ws zod
RUN apt-get update && apt-get install -y --no-install-recommends blender ffmpeg fonts-dejavu-core libsndfile1 && rm -rf /var/lib/apt/lists/*
COPY deploy/runner/creative-requirements.txt /opt/toolchain/creative-requirements.txt
RUN /opt/python/bin/pip install --no-cache-dir -r /opt/toolchain/creative-requirements.txt && /opt/python/bin/pip freeze > /opt/toolchain/python-installed.txt
RUN npm install --save-exact three @react-three/fiber @react-three/drei cannon-es phaser gsap
COPY deploy/runner/runtime-info.py /opt/toolchain/runtime-info.py
COPY deploy/runner/install-packages.py /opt/toolchain/install-packages.py
COPY deploy/runner/install-node.mjs /opt/toolchain/install-node.mjs
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng tesseract-ocr-rus poppler-utils && rm -rf /var/lib/apt/lists/*
COPY deploy/runner/browser.mjs /opt/toolchain/browser.mjs
COPY server/webhook-worker.mjs /opt/toolchain/webhook-runtime.mjs
COPY server/webhook-network.mjs /opt/toolchain/webhook-network.mjs
COPY deploy/runner/webhook-cli.mjs /opt/toolchain/webhook-worker.mjs
ENV PATH="/opt/python/bin:/opt/toolchain/node_modules/.bin:${PATH}" NODE_PATH=/opt/toolchain/node_modules GOCACHE=/tmp/go-cache GOTMPDIR=/workspace JAVA_TOOL_OPTIONS="-XX:ActiveProcessorCount=1 -XX:MaxRAMPercentage=50 -XX:-UsePerfData"
ENV MPLCONFIGDIR=/tmp/matplotlib NUMBA_CACHE_DIR=/tmp/numba XDG_CACHE_HOME=/tmp/cache OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy
USER node
WORKDIR /workspace
