#!/usr/bin/env bash
# install.sh — Automated Linux (Ubuntu/Debian/Fedora/Arch) & macOS Installer for TuxScout
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/SuparvaCode/tuxscout/main/install.sh | bash
#   chmod +x install.sh && ./install.sh
#   ./install.sh --systemd    # (Linux) Also install & start systemd service on port 8787

set -euo pipefail

OS_NAME="$(uname -s)"
ARCH_UNAME="$(uname -m)"

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  fi
fi

echo "======================================================================"
echo "  Installing TuxScout (${OS_NAME} / ${ARCH_UNAME})"
echo "======================================================================"

# 1. System Packages (ffmpeg, Chromium, curl)
if [ "$OS_NAME" = "Darwin" ]; then
  echo "[1/5] Detected macOS..."
  if command -v brew >/dev/null 2>&1; then
    echo "      Checking ffmpeg via Homebrew..."
    command -v ffmpeg >/dev/null 2>&1 || brew install ffmpeg || true
  fi
elif command -v apt-get >/dev/null 2>&1; then
  echo "[1/5] Updating apt and installing Linux dependencies (ffmpeg, Chromium libs)..."
  $SUDO apt-get update -y
  $SUDO apt-get install -y \
    curl wget ca-certificates gnupg ffmpeg python3 \
    fonts-liberation libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libcups2
  $SUDO apt-get install -y libasound2t64 2>/dev/null || $SUDO apt-get install -y libasound2 || true

  if ! command -v chromium-browser >/dev/null 2>&1 && ! command -v chromium >/dev/null 2>&1 && ! command -v google-chrome >/dev/null 2>&1 && ! command -v google-chrome-stable >/dev/null 2>&1; then
    echo "      Installing headless Chromium / Chrome..."
    if ! ($SUDO apt-get install -y chromium 2>/dev/null || $SUDO apt-get install -y chromium-browser 2>/dev/null); then
      if [ "$(dpkg --print-architecture)" = "amd64" ]; then
        wget -q -O /tmp/google-chrome-stable_current_amd64.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
        $SUDO apt-get install -y /tmp/google-chrome-stable_current_amd64.deb
        rm -f /tmp/google-chrome-stable_current_amd64.deb
      fi
    fi
  fi
elif command -v dnf >/dev/null 2>&1; then
  echo "[1/5] Installing dependencies via dnf (Fedora/RHEL)..."
  $SUDO dnf install -y curl ffmpeg chromium || true
elif command -v pacman >/dev/null 2>&1; then
  echo "[1/5] Installing dependencies via pacman (Arch Linux)..."
  $SUDO pacman -Sy --noconfirm curl ffmpeg chromium || true
fi

# 2. Install standalone yt-dlp binary into ~/.tuxscout/bin (and /usr/local/bin if writable)
echo "[2/5] Bootstrapping latest standalone yt-dlp binary..."
mkdir -p "$HOME/.tuxscout/bin"
YTDLP_ASSET="yt-dlp_linux"
if [ "$OS_NAME" = "Darwin" ]; then
  YTDLP_ASSET="yt-dlp_macos"
elif [ "$ARCH_UNAME" = "aarch64" ] || [ "$ARCH_UNAME" = "arm64" ]; then
  YTDLP_ASSET="yt-dlp_linux_aarch64"
fi
curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/${YTDLP_ASSET}" -o "$HOME/.tuxscout/bin/yt-dlp"
chmod +x "$HOME/.tuxscout/bin/yt-dlp"
if [ -n "$SUDO" ] || [ -w /usr/local/bin ]; then
  $SUDO cp "$HOME/.tuxscout/bin/yt-dlp" /usr/local/bin/yt-dlp 2>/dev/null || true
fi

# 3. Ensure Node.js >= 18 is installed
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 18 ]; then
  echo "[3/5] Installing Node.js LTS..."
  if [ "$OS_NAME" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
    brew install node
  elif command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
    $SUDO apt-get install -y nodejs
  fi
else
  echo "[3/5] Node.js $(node -v) detected."
fi

# 4. Build & Global Install via npm install -g
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || pwd)"
if [ -f "${SCRIPT_DIR}/package.json" ]; then
  echo "[4/5] Building & installing TuxScout globally from ${SCRIPT_DIR}..."
  cd "$SCRIPT_DIR"
  npm install
  npm run build
  chmod +x dist/cli.js dist/bin/*.js
  npm install -g . 2>/dev/null || $SUDO npm install -g .
else
  echo "[4/5] Installing TuxScout globally via npm registry (tuxscout)..."
  if ! npm install -g tuxscout 2>/dev/null && ! $SUDO npm install -g tuxscout; then
    REPO_URL="${TUXSCOUT_GIT_URL:-git+https://github.com/SuparvaCode/tuxscout.git}"
    echo "      Fallback: Installing TuxScout globally from ${REPO_URL}..."
    npm install -g "${REPO_URL}" 2>/dev/null || $SUDO npm install -g "${REPO_URL}"
  fi
fi

# Optional systemd daemon setup on Linux
if [ "${1:-}" = "--systemd" ] && [ "$OS_NAME" = "Linux" ]; then
  PORT="${PORT:-8787}"
  echo "[+] Configuring systemd service (tuxscout.service) on port ${PORT}..."
  SERVICE_FILE="/etc/systemd/system/tuxscout.service"
  $SUDO tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=TuxScout AI Agent Toolkit HTTP API Server
After=network.target

[Service]
Type=simple
WorkingDirectory=${SCRIPT_DIR}
ExecStart=$(command -v node) ${SCRIPT_DIR}/dist/server.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
Environment=PORT=${PORT}

[Install]
WantedBy=multi-user.target
EOF
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable tuxscout
  $SUDO systemctl restart tuxscout
  echo "      -> systemd service 'tuxscout' started on http://0.0.0.0:${PORT}"
fi

echo "[5/5] Running TuxScout setup check..."
tuxscout setup || node "${SCRIPT_DIR}/dist/cli.js" setup
