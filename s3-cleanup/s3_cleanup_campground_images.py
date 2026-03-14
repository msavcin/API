#!/usr/bin/env python3
"""
S3 Kamp Alanı Fotoğrafları Temizleyici
=======================================
Veritabanındaki campgrounds.photo_links ve campground_images.image_url
kolonlarında referans edilmeyen S3 fotoğraflarını campground_images/ klasöründen siler.

Kullanım:
  python s3_cleanup_campground_images.py            → Dry-run modu (silmez, sadece listeler)
  python s3_cleanup_campground_images.py --delete   → Gerçekten siler

Ortam değişkenleri için proje kök dizinindeki .env dosyası otomatik yüklenir.
"""

import argparse
import json
import logging
import sys
import re
from pathlib import Path
from urllib.parse import urlparse

import boto3
import psycopg2
from botocore.exceptions import BotoCoreError, ClientError
from dotenv import load_dotenv
import os

# ── Loglama Ayarları ────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(Path(__file__).parent / "s3_cleanup.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger(__name__)

# ── .env Yükleme ─────────────────────────────────────────────────────────────
# Önce bu scriptin dizinine, sonra bir üst (proje kök) dizinine bak
_env_paths = [
    Path(__file__).parent / ".env",
    Path(__file__).parent.parent / ".env",
]
for _p in _env_paths:
    if _p.exists():
        load_dotenv(_p)
        logger.info(f".env dosyası yüklendi: {_p}")
        break

S3_BUCKET        = os.getenv("AWS_S3_BUCKET")
S3_REGION        = os.getenv("AWS_REGION", "eu-central-1")
AWS_KEY_ID       = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_KEY   = os.getenv("AWS_SECRET_ACCESS_KEY")
S3_PREFIX        = "campground_images/"

# config/config.json'dan DB bilgilerini oku (Node.js projesiyle uyumlu fallback)
def _load_config_json() -> dict:
    env_name = os.getenv("NODE_ENV", "production")
    for base in (Path(__file__).parent, Path(__file__).parent.parent):
        cfg_path = base / "config" / "config.json"
        if cfg_path.exists():
            try:
                with open(cfg_path, encoding="utf-8") as f:
                    data = json.load(f)
                return data.get(env_name) or data.get("production") or {}
            except Exception:
                pass
    return {}

_cfg = _load_config_json()

DB_HOST = os.getenv("DB_HOST") or _cfg.get("host", "localhost")
DB_PORT = int(os.getenv("DB_PORT") or _cfg.get("port", 5432))
DB_NAME = os.getenv("DB_NAME") or _cfg.get("database", "kampdefterim")
DB_USER = os.getenv("DB_USER") or _cfg.get("username", "postgres")
DB_PASS = os.getenv("DB_PASSWORD") or _cfg.get("password", "")


# ── Yardımcı: URL → S3 Key ────────────────────────────────────────────────────
def url_to_s3_key(url: str, bucket: str) -> str | None:
    """
    Bir S3 URL'sinden nesne key'ini çıkarır.
    Desteklenen formatlar:
      - https://<bucket>.s3.<region>.amazonaws.com/<key>          (virtual-hosted)
      - https://s3.<region>.amazonaws.com/<bucket>/<key>          (path-style)
      - https://<bucket>.s3.amazonaws.com/<key>
      - Sadece key kendisi (URL değil)
    """
    if not url or not isinstance(url, str):
        return None
    url = url.strip()
    if not url.startswith("http"):
        # Doğrudan key olarak kabul et
        return url if url.startswith(S3_PREFIX) else None
    try:
        parsed = urlparse(url)
        host   = parsed.hostname or ""
        path   = parsed.path.lstrip("/")
        # Virtual-hosted style: <bucket>.s3...amazonaws.com
        if bucket and host.startswith(f"{bucket}."):
            return path  # path direkt key
        # Path-style: s3...amazonaws.com/<bucket>/<key>
        if host.startswith("s3.") or re.match(r"s3-[\w-]+\.amazonaws\.com", host):
            # path: <bucket>/<key>  →  strip bucket prefix
            prefix = f"{bucket}/"
            if path.startswith(prefix):
                return path[len(prefix):]
        # Fallback: path içinde /campground_images/ varsa oradan başlat
        idx = path.find(S3_PREFIX)
        if idx != -1:
            return path[idx:]
    except Exception:
        pass
    return None


# ── DB: Tüm referans edilen S3 key'leri topla ───────────────────────────────
def fetch_referenced_keys(conn, bucket: str) -> set[str]:
    """
    campgrounds.photo_links (JSON dizi) ve
    campground_images.image_url kolonlarındaki tüm URL'leri okuyup
    S3 key setini döndürür.
    """
    referenced: set[str] = set()
    with conn.cursor() as cur:
        # 1. campgrounds.photo_links  (TEXT, JSON dizi)
        cur.execute("SELECT photo_links FROM campgrounds WHERE photo_links IS NOT NULL AND photo_links != '[]';")
        for (raw,) in cur.fetchall():
            try:
                links = json.loads(raw) if isinstance(raw, str) else raw
                if not isinstance(links, list):
                    continue
                for url in links:
                    key = url_to_s3_key(url, bucket)
                    if key and key.startswith(S3_PREFIX):
                        referenced.add(key)
            except (json.JSONDecodeError, TypeError):
                logger.warning(f"photo_links parse edilemedi: {raw!r:.80}")

        # 2. campground_images.image_url
        cur.execute("SELECT image_url FROM campground_images WHERE image_url IS NOT NULL;")
        for (url,) in cur.fetchall():
            key = url_to_s3_key(url, bucket)
            if key and key.startswith(S3_PREFIX):
                referenced.add(key)

    logger.info(f"Veritabanından {len(referenced)} benzersiz S3 key'i okundu.")
    return referenced


# ── S3: campground_images/ altındaki tüm nesneleri listele ──────────────────
def list_s3_keys(s3_client, bucket: str, prefix: str) -> list[str]:
    """S3 bucket'taki belirtilen prefix altındaki tüm nesne key'lerini döndürür."""
    keys   = []
    kwargs = {"Bucket": bucket, "Prefix": prefix}
    while True:
        resp = s3_client.list_objects_v2(**kwargs)
        for obj in resp.get("Contents", []):
            keys.append(obj["Key"])
        if resp.get("IsTruncated"):
            kwargs["ContinuationToken"] = resp["NextContinuationToken"]
        else:
            break
    logger.info(f"S3'te {len(keys)} nesne bulundu (prefix: {prefix}).")
    return keys


# ── S3: Toplu Silme (max 1000 / istek) ─────────────────────────────────────
def delete_s3_keys(s3_client, bucket: str, keys: list[str], dry_run: bool) -> int:
    """
    Verilen key listesini S3'ten siler.
    dry_run=True ise silmez, yalnızca listeler.
    Silinen nesne sayısını döndürür.
    """
    if not keys:
        logger.info("Silinecek nesne bulunamadı.")
        return 0

    if dry_run:
        logger.info(f"[DRY-RUN] {len(keys)} nesne silinecekti:")
        for k in keys:
            logger.info(f"  🗑  {k}")
        return 0

    deleted_count = 0
    chunk_size    = 1000  # AWS sınırı

    for i in range(0, len(keys), chunk_size):
        chunk  = keys[i: i + chunk_size]
        delete = {"Objects": [{"Key": k} for k in chunk], "Quiet": True}
        resp   = s3_client.delete_objects(Bucket=bucket, Delete=delete)

        errors = resp.get("Errors", [])
        if errors:
            for err in errors:
                logger.error(f"Silme hatası → {err['Key']}: {err['Code']} - {err['Message']}")

        succeeded = len(chunk) - len(errors)
        deleted_count += succeeded
        logger.info(f"Silme: {succeeded}/{len(chunk)} nesne başarıyla silindi (batch {i // chunk_size + 1}).")

    return deleted_count


# ── Ana Akış ────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="S3 campground_images/ klasöründeki gereksiz fotoğrafları temizler."
    )
    parser.add_argument(
        "--delete",
        action="store_true",
        default=False,
        help="Silinecek nesneleri gerçekten sil (varsayılan: dry-run, sadece listeler)",
    )
    args = parser.parse_args()
    dry_run = not args.delete

    if dry_run:
        logger.info("=" * 60)
        logger.info("  DRY-RUN MODU — hiçbir nesne silinmeyecek")
        logger.info("  Gerçekten silmek için --delete parametresini kullanın")
        logger.info("=" * 60)
    else:
        logger.warning("=" * 60)
        logger.warning("  GERÇEK SİLME MODU — eşleşmeyen S3 nesneleri silinecek!")
        logger.warning("=" * 60)

    # Ortam değişkeni kontrolü
    missing = [v for v in ("AWS_S3_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY") if not os.getenv(v)]
    if missing:
        logger.error(f"Eksik ortam değişkenleri: {', '.join(missing)}")
        sys.exit(1)

    # DB Bağlantısı
    try:
        conn = psycopg2.connect(
            host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
            user=DB_USER, password=DB_PASS,
            connect_timeout=10,
        )
        conn.autocommit = True
        logger.info(f"PostgreSQL bağlantısı kuruldu: {DB_HOST}:{DB_PORT}/{DB_NAME}")
    except psycopg2.OperationalError as e:
        logger.error(f"Veritabanı bağlantı hatası: {e}")
        sys.exit(1)

    # S3 İstemcisi
    try:
        s3_client = boto3.client(
            "s3",
            region_name=S3_REGION,
            aws_access_key_id=AWS_KEY_ID,
            aws_secret_access_key=AWS_SECRET_KEY,
        )
        # Bağlantı testi
        s3_client.head_bucket(Bucket=S3_BUCKET)
        logger.info(f"S3 bağlantısı kuruldu: bucket={S3_BUCKET}, region={S3_REGION}")
    except (BotoCoreError, ClientError) as e:
        logger.error(f"S3 bağlantı hatası: {e}")
        conn.close()
        sys.exit(1)

    try:
        referenced_keys = fetch_referenced_keys(conn, S3_BUCKET)
        s3_keys         = list_s3_keys(s3_client, S3_BUCKET, S3_PREFIX)

        # Veritabanında referans edilmeyen key'leri bul
        orphan_keys = [k for k in s3_keys if k not in referenced_keys]

        logger.info("-" * 60)
        logger.info(f"S3'teki toplam nesne   : {len(s3_keys)}")
        logger.info(f"DB'deki referans sayısı: {len(referenced_keys)}")
        logger.info(f"Sahipsiz (orphan) nesne: {len(orphan_keys)}")
        logger.info("-" * 60)

        deleted = delete_s3_keys(s3_client, S3_BUCKET, orphan_keys, dry_run)

        if not dry_run and deleted > 0:
            logger.info(f"Toplam {deleted} sahipsiz nesne S3'ten silindi.")
        elif dry_run and orphan_keys:
            logger.info("Dry-run tamamlandı. --delete ile tekrar çalıştırmak gerçekten siler.")
        else:
            logger.info("Temizlenecek sahipsiz nesne yok. Her şey düzenli!")

    finally:
        conn.close()
        logger.info("Veritabanı bağlantısı kapatıldı.")


if __name__ == "__main__":
    main()
