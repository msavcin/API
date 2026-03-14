#!/bin/bash
# S3 Campground Images Cleanup
# Kullanım:
#   ./run.sh           → dry-run (silmez, sadece listeler)
#   ./run.sh --delete  → gerçekten siler
#
# Cron örneği (Her Pazar gece yarısı):
#   0 0 * * 0 /path/to/API/s3-cleanup/run.sh --delete

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"

# Sanal ortam yoksa oluştur ve bağımlılıkları yükle
if [ ! -d "$VENV_DIR" ]; then
    echo "[setup] Sanal ortam oluşturuluyor..."
    python3 -m venv "$VENV_DIR"
    echo "[setup] Bağımlılıklar yükleniyor..."
    "$VENV_DIR/bin/pip" install --quiet --upgrade pip
    "$VENV_DIR/bin/pip" install --quiet -r "$SCRIPT_DIR/requirements.txt"
    echo "[setup] Hazır."
fi

# Scripti çalıştır
exec "$VENV_DIR/bin/python" "$SCRIPT_DIR/s3_cleanup_campground_images.py" "$@"
