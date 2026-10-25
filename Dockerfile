FROM node:22-bookworm-slim

# Install minimal Chromium, ffmpeg, curl, python3, and shared libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ffmpeg \
    curl \
    ca-certificates \
    python3 \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Install latest standalone yt-dlp
RUN ARCH="$(uname -m)" && \
    ASSET="yt-dlp_linux" && \
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then ASSET="yt-dlp_linux_aarch64"; fi && \
    curl -L --fail "https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ASSET}" -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PORT=8787

WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build && npm link

EXPOSE 8787
CMD ["node", "dist/server.js"]
