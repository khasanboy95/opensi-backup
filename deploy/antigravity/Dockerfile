FROM opensi-runtime:0.10.0
USER root
RUN apt-get update && apt-get install -y --no-install-recommends curl dbus gnome-keyring libsecret-tools && rm -rf /var/lib/apt/lists/*
RUN curl --compressed -fsSL https://antigravity.google/cli/install.sh -o /tmp/install-agy.sh && bash /tmp/install-agy.sh --dir /opt/agy && rm /tmp/install-agy.sh
COPY public/downloads/opensi-connector.zip /tmp/connector.zip
RUN mkdir -p /opt/connector /state /workspace /run/opensi && unzip -p /tmp/connector.zip opensi-connector.mjs > /opt/connector/opensi-connector.mjs && rm /tmp/connector.zip && chown -R node:node /state /workspace /run/opensi
COPY deploy/antigravity/start.sh /opt/connector/start.sh
COPY deploy/antigravity/service.mjs /opt/connector/service.mjs
RUN chmod 755 /opt/connector/start.sh
ENV HOME=/state XDG_RUNTIME_DIR=/run/opensi DBUS_SESSION_BUS_ADDRESS=unix:path=/run/opensi/bus AGY_CLI_DISABLE_AUTO_UPDATE=true
USER node
WORKDIR /workspace
ENTRYPOINT ["/opt/connector/start.sh"]
