#!/bin/bash
# KGM Çalışma Yollar - Kurulum ve Çalıştırma Betiği
# Kullanım: bash calistir.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"

# Sanal ortam yoksa oluştur
if [ ! -d "$VENV_DIR" ]; then
    echo "🔧 Sanal ortam oluşturuluyor..."
    python3 -m venv "$VENV_DIR"
fi

# Sanal ortamı etkinleştir
source "$VENV_DIR/bin/activate"

# Bağımlılıkları yükle (zaten yüklüyse atlanır)
pip install --quiet --upgrade pip
pip install --quiet requests beautifulsoup4 psycopg2-binary

echo "✅ Bağımlılıklar hazır."
echo ""

# Ana scripti çalıştır
python "$SCRIPT_DIR/kgm_calisma_yollar.py"

deactivate
