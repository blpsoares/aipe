#!/bin/sh
# AIPe installer. Downloads the standalone `aipe` binary for this OS/arch and
# puts it on the PATH — no Bun/Node/npm required.
#
#   curl -fsSL https://aipe.openvibes.tech/cli | sh
#
# Env overrides:
#   AIPE_DOWNLOAD_BASE  where to fetch binaries (default the AIPe domain)
#   AIPE_INSTALL_DIR    where to install (default ~/.local/bin)
#   AIPE_VERSION        version label (informational; the domain serves latest)
set -eu

AIPE_VERSION="${AIPE_VERSION:-0.2.2}"
AIPE_DOWNLOAD_BASE="${AIPE_DOWNLOAD_BASE:-https://aipe.openvibes.tech/cli}"
INSTALL_DIR="${AIPE_INSTALL_DIR:-$HOME/.local/bin}"

os="$(uname -s 2>/dev/null || echo unknown)"
arch="$(uname -m 2>/dev/null || echo unknown)"
case "$os" in
  Linux) os="linux" ;;
  Darwin) os="darwin" ;;
  *) echo "aipe: unsupported OS '$os' (need Linux or macOS; on Windows use install.ps1)" >&2; exit 1 ;;
esac
case "$arch" in
  x86_64 | amd64) arch="x64" ;;
  arm64 | aarch64) arch="arm64" ;;
  *) echo "aipe: unsupported arch '$arch'" >&2; exit 1 ;;
esac
label="${os}-${arch}"
url="$AIPE_DOWNLOAD_BASE/aipe-$label"

echo "aipe: installing $label from $url"
mkdir -p "$INSTALL_DIR"
target="$INSTALL_DIR/aipe"

if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$url" -o "$target"
elif command -v wget >/dev/null 2>&1; then
  wget -q "$url" -O "$target"
else
  echo "aipe: need curl or wget to download" >&2
  exit 1
fi
chmod +x "$target"

echo "aipe: installed to $target"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) : ;;
  *) echo "aipe: add $INSTALL_DIR to your PATH, e.g.:"
     echo "        export PATH=\"$INSTALL_DIR:\$PATH\"" ;;
esac
echo "aipe: run 'aipe start' in your project folder to set up a workspace."
