"""
KGM Çalışma Yapılan Yollar - Veri Toplayıcı
==============================================
KGM'nin bölge bazlı "Çalışma Yapılan Yollar" sayfalarından veri çeker,
announcements tablosuna kaydeder.

Mantık:
- Bildirim Tarihi → baslama_zamani
- Güncelleme Tarihi + 7 gün → bitis_zamani
- Güncelleme tarihi değişirse bitis_zamani otomatik güncellenir
- Süresi dolan kayıtlar aktif=False yapılır

Kaynak: https://www.kgm.gov.tr/Sayfalar/KGM/SiteTr/YolDanisma/CalismaYapilanYollarYeni.aspx?Bolge={1..18}
"""

import requests
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
from typing import Optional, List
import json
import re
import psycopg2
import traceback
import time

# --- Sabitler ---
SOURCE_KGM = 2
KGM_BASE = "https://www.kgm.gov.tr"
KGM_SAYFA_SABLONU = (
    "https://www.kgm.gov.tr/Sayfalar/KGM/SiteTr/YolDanisma/"
    "CalismaYapilanYollarYeni.aspx?Bolge={bolge}"
)
MAX_BOLGE = 18           # Var olmayan bölgeler otomatik atlanır
BITIS_OFFSET_GUN = 7    # Güncelleme Tarihi + 7 gün = bitis_zamani

# --- Veritabanı Ayarları ---
DB_CONFIG = {
    "host": "localhost",
    "database": "kampdefterim",
    "user": "postgres",
    "password": "s1vc10n",
    "port": "5432",
}

# --- Plaka Kodları ---
PLAKA_KODLARI = {
    "adana": 1, "adiyaman": 2, "afyonkarahisar": 3, "afyon": 3,
    "agri": 4, "aksaray": 68, "amasya": 5, "ankara": 6,
    "antalya": 7, "ardahan": 75, "artvin": 8, "aydin": 9,
    "balikesir": 10, "bartin": 74, "batman": 72, "bayburt": 69,
    "bilecik": 11, "bingol": 12, "bitlis": 13, "bolu": 14,
    "burdur": 15, "bursa": 16, "canakkale": 17, "cankiri": 18,
    "corum": 19, "denizli": 20, "diyarbakir": 21, "duzce": 81,
    "edirne": 22, "elazig": 23, "erzincan": 24, "erzurum": 25,
    "eskisehir": 26, "gaziantep": 27, "giresun": 28, "gumushane": 29,
    "hakkari": 30, "hatay": 31, "igdir": 76, "isparta": 32,
    "istanbul": 34, "izmir": 35, "kahramanmaras": 46, "karabuk": 78,
    "karaman": 70, "kars": 36, "kastamonu": 37, "kayseri": 38,
    "kirikkale": 71, "kirklareli": 39, "kirsehir": 40, "kilis": 79,
    "kocaeli": 41, "konya": 42, "kutahya": 43, "malatya": 44,
    "manisa": 45, "mardin": 47, "mersin": 33, "mugla": 48,
    "mus": 49, "nevsehir": 50, "nigde": 51, "ordu": 52,
    "osmaniye": 80, "rize": 53, "sakarya": 54, "samsun": 55,
    "siirt": 56, "sinop": 57, "sivas": 58, "sanliurfa": 63,
    "sirnak": 73, "tekirdag": 59, "tokat": 60, "trabzon": 61,
    "tunceli": 62, "usak": 64, "van": 65, "yalova": 77,
    "yozgat": 66, "zonguldak": 67,
}

# Türkçe → ASCII normalleştirme haritası
TR_MAP = str.maketrans(
    "çÇğĞıİöÖşŞüÜâÂîÎûÛ",
    "cCgGiIoOssuuaAiIuU",
)


def normalize(metin: str) -> str:
    """Türkçe karakterleri ASCII'ye çevirir, küçük harf yapar."""
    return metin.translate(TR_MAP).lower()


# Normalize edilmiş plaka tablosu (arama için)
_PLAKA_NORM = {normalize(il): kod for il, kod in PLAKA_KODLARI.items()}


# ===========================================================================
# Veritabanı Fonksiyonları
# ===========================================================================

def db_baglanti():
    """PostgreSQL bağlantısı döndürür."""
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        conn.autocommit = False
        return conn
    except Exception as e:
        print(f"❌ DB bağlantı hatası: {e}")
        return None


def tabloyu_hazirla():
    """announcements tablosunu ve gerekli sütunları oluşturur."""
    conn = db_baglanti()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            # Tablo
            cur.execute("""
                CREATE TABLE IF NOT EXISTS announcements (
                    id SERIAL PRIMARY KEY,
                    valilik_id INTEGER NOT NULL,
                    date VARCHAR(10) NOT NULL,
                    title TEXT NOT NULL,
                    keywords JSONB,
                    source INTEGER DEFAULT 0,
                    link TEXT NOT NULL,
                    source_url TEXT NOT NULL,
                    islenme_tarihi TIMESTAMP NOT NULL,
                    community_id INTEGER DEFAULT 0,
                    message TEXT DEFAULT '',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    baslama_zamani TIMESTAMP,
                    bitis_zamani TIMESTAMP,
                    aktif BOOLEAN DEFAULT TRUE
                );
            """)
            # Ek sütunlar (yoksa ekle)
            for sutun_sql in [
                "ALTER TABLE announcements ADD COLUMN IF NOT EXISTS baslama_zamani TIMESTAMP;",
                "ALTER TABLE announcements ADD COLUMN IF NOT EXISTS bitis_zamani TIMESTAMP;",
                "ALTER TABLE announcements ADD COLUMN IF NOT EXISTS aktif BOOLEAN DEFAULT TRUE;",
                "ALTER TABLE announcements ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;",
            ]:
                cur.execute(sutun_sql)
            # UNIQUE kısıt
            cur.execute("""
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conname = 'announcements_date_title_valilik_id_source_key'
                    ) THEN
                        ALTER TABLE announcements
                        ADD CONSTRAINT announcements_date_title_valilik_id_source_key
                        UNIQUE (date, title, valilik_id, source);
                    END IF;
                END $$;
            """)
            # İndeksler
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_ann_source
                    ON announcements(source);
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_ann_valilik_source
                    ON announcements(valilik_id, source);
            """)
            conn.commit()
            print("✅ Tablo hazır.")
    except Exception as e:
        print(f"❌ Tablo hazırlama hatası: {e}")
        conn.rollback()
    finally:
        conn.close()


def suresi_dolanlari_pasife_al():
    """bitis_zamani geçmiş KGM kayıtlarını aktif=False yapar."""
    conn = db_baglanti()
    if not conn:
        return 0
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE announcements
                SET aktif = FALSE, updated_at = NOW()
                WHERE source = %s::integer
                  AND aktif = TRUE
                  AND bitis_zamani IS NOT NULL
                  AND bitis_zamani < NOW()
            """, (SOURCE_KGM,))
            n = cur.rowcount
            conn.commit()
            if n:
                print(f"🔴 {n} KGM kaydı süresi doldu → pasife alındı.")
            return n
    except Exception as e:
        print(f"❌ Pasife alma hatası: {e}")
        conn.rollback()
        return 0
    finally:
        conn.close()


def pasif_kayitlari_sil():
    """Aktif=False olan KGM kayıtlarını siler."""
    conn = db_baglanti()
    if not conn:
        return 0
    try:
        with conn.cursor() as cur:
            cur.execute("""
                DELETE FROM announcements
                WHERE source = %s::integer AND aktif = FALSE
            """, (SOURCE_KGM,))
            n = cur.rowcount
            conn.commit()
            print(f"🗑️  {n} pasif KGM kaydı silindi.")
            return n
    except Exception as e:
        print(f"❌ Silme hatası: {e}")
        conn.rollback()
        return 0
    finally:
        conn.close()


def kayit_ekle_veya_guncelle(veri: dict) -> bool:
    """
    Yeni kayıt ekler ya da güncelleme tarihi değişmişse bitis_zamani'nı günceller.
    veri anahtarları: valilik_id, date, title, keywords, link, source_url,
                      message, baslama_zamani, bitis_zamani
    """
    conn = db_baglanti()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            # Mevcut kaydı ara: aynı başlık + il + kaynak
            cur.execute("""
                SELECT id, bitis_zamani
                FROM announcements
                WHERE source = %s
                  AND valilik_id::integer = %s
                  AND title = %s
                LIMIT 1
            """, (SOURCE_KGM, int(veri["valilik_id"]), veri["title"]))
            mevcut = cur.fetchone()

            if mevcut:
                rec_id, eski_bitis = mevcut
                yeni_bitis = veri["bitis_zamani"]

                # Güncelleme tarihi değiştiyse bitis_zamani'ı güncelle
                degisti = (
                    eski_bitis is None
                    or yeni_bitis is None
                    or abs((eski_bitis - yeni_bitis).total_seconds()) > 60
                )
                if degisti:
                    cur.execute("""
                        UPDATE announcements
                        SET bitis_zamani = %s,
                            message = %s,
                            aktif = TRUE,
                            updated_at = NOW()
                        WHERE id = %s
                    """, (yeni_bitis, veri["message"], rec_id))
                    conn.commit()
                    print(f"    🔄 Güncellendi (ID:{rec_id}) → bitis: {yeni_bitis}")
                return True

            # Yeni kayıt
            cur.execute("""
                INSERT INTO announcements
                    (valilik_id, date, title, keywords, source, link,
                     source_url, islenme_tarihi, community_id, message,
                     baslama_zamani, bitis_zamani, aktif)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT ON CONSTRAINT announcements_date_title_valilik_id_source_key
                DO UPDATE SET
                    bitis_zamani = EXCLUDED.bitis_zamani,
                    message      = EXCLUDED.message,
                    aktif        = TRUE,
                    updated_at   = NOW()
                RETURNING id
            """, (
                str(veri["valilik_id"]),
                veri["date"],
                veri["title"],
                json.dumps(veri["keywords"], ensure_ascii=False),
                SOURCE_KGM,
                veri["link"],
                veri["source_url"],
                datetime.now(),
                0,
                veri["message"],
                veri["baslama_zamani"],
                veri["bitis_zamani"],
                True,
            ))
            row = cur.fetchone()
            conn.commit()
            if row:
                print(f"    ✅ Eklendi (ID:{row[0]})")
            return True

    except Exception as e:
        print(f"    ❌ Kayıt hatası: {e}")
        print(f"       {traceback.format_exc()}")
        conn.rollback()
        return False
    finally:
        conn.close()


# ===========================================================================
# Yardımcı / Çıkarım Fonksiyonları
# ===========================================================================

def tarih_cevir(metin: str) -> Optional[datetime]:
    """
    'D.MM.YYYY SS:DD:SS' veya 'D.MM.YYYY' biçimindeki tarihi
    datetime nesnesine çevirir.
    """
    metin = metin.strip()
    for fmt in ("%d.%m.%Y %H:%M:%S", "%d.%m.%Y %H:%M", "%d.%m.%Y"):
        try:
            return datetime.strptime(metin, fmt)
        except ValueError:
            continue
    print(f"    ⚠️  Tarih ayrıştırılamadı: '{metin}'")
    return None


def plaka_kesim_kodundan(kesim_kodu: str) -> Optional[int]:
    """
    Yol kesim kodunun başındaki sayının plaka kodu olup olmadığını
    döndürür.
    Örnekler:
      '35-36'  → 35   (İzmir)
      '45-05'  → 45   (Manisa)
      '09-03'  → 9    (Aydın)
      '010-07' → None (3 haneli → karayolu no, plaka değil)
      '100-02' → None (3 haneli → D-100 karayolu, plaka değil)
      'O-2/03' → None (otoyol)
    İl plaka kodları en fazla 2 haneli (01–81) olduğundan yalnızca
    1–2 haneli ön ekler değerlendirilir.
    """
    m = re.match(r"^(\d{1,2})[/-]", kesim_kodu.strip())
    if m:
        sayi = int(m.group(1))
        if 1 <= sayi <= 81:
            return sayi
    return None


def ilce_il_eslesme() -> dict:
    """
    Sık geçen ilçe / bölge adlarının plaka koduna eşlemesi.
    Tam kapsamlı değil; metinde plaka-seviyesi il bulunamazsa devreye girer.
    """
    return {
        # İzmir ilçeleri
        "torbali": 35, "odemis": 35, "seferihisar": 35, "selcuk": 35,
        "bornova": 35, "buca": 35, "karsiyaka": 35, "cesme": 35,
        "urla": 35, "gaziemir": 35, "konak": 35, "cigli": 35,
        "karabaglar": 35, "balcova": 35, "narlidere": 35, "guzelbahce": 35,
        "menderes": 35, "tire": 35, "kiraz": 35, "bergama": 35,
        "dikili": 35, "aliaga": 35, "menemen": 35, "kemalpasa": 35,
        "beydag": 35, "ayvalik": 10,
        # Manisa ilçeleri
        "turgutlu": 45, "akhisar": 45, "salihli": 45, "soma": 45,
        "gordes": 45, "kirkagac": 45, "demirci": 45, "koprubasi": 45,
        "sindirgi": 45,
        # Aydın ilçeleri
        "kusadasi": 9, "nazilli": 9, "soke": 9, "incirliova": 9,
        "sultanhisar": 9, "yenipazar": 9, "bozdogan": 9, "kosk": 9,
        "germencik": 9, "cine": 9, "karacasu": 9,
        # Denizli ilçeleri
        "sarayköy": 20, "saraykoy": 20, "babadagi": 20, "babadağ": 20,
        "buldan": 20, "civril": 20, "cal": 20, "cardak": 20,
        "cameli": 20, "honaz": 20,
        # Muğla ilçeleri
        "marmaris": 48, "bodrum": 48, "milas": 48, "fethiye": 48,
        "datca": 48, "yalikavak": 48, "koycegiz": 48, "ula": 48,
        "yatagan": 48, "ortaca": 48,
        # Uşak ilçeleri
        "banaz": 64, "sivasli": 64, "ulubey": 64, "esme": 64,
        # İstanbul ilçeleri
        "sultanbeyli": 34, "kandira": 41, "gaziosmanpasa": 34,
        "gumushane": 29,
        # Kocaeli ilçeleri
        "gebze": 41, "darica": 41, "golcuk": 41, "izmit": 41,
        "basiskele": 41, "derince": 41, "korfez": 41, "kartepe": 41,
        # Sakarya ilçeleri
        "adapazari": 54, "hendek": 54, "sapanca": 54,
        # Tekirdağ ilçeleri
        "corlu": 59, "malkara": 59, "hayrabolu": 59,
        # Kırklareli ilçeleri
        "igneada": 39, "demirkoy": 39, "poyral": 39, "kirklareli": 39,
        # Edirne ilçeleri
        "kesan": 22, "ipsala": 22, "uzunkopru": 22,
        # Çanakkale ilçeleri
        "eceabat": 17, "gelibolu": 17,
        # Balıkesir ilçeleri
        "bandirma": 10, "gonen": 10, "erdek": 10, "edremit": 10,
        "burhaniye": 10, "havran": 10,
    }


_ILCE_IL = ilce_il_eslesme()


def plaka_metinden_cikari(metin: str) -> List[int]:
    """
    Açıklama metninden plaka numaralarını bulur.
    Önce il adlarını, sonra ilçe adlarını arar.
    Sayısal değerler aramadan önce metinden çıkarılır.
    """
    bulunan: List[int] = []
    # Rakamları ve noktalama işaretlerini temizle; sadece harf ve boşluk bırak
    norm = re.sub(r"[^a-z\s]", " ", normalize(metin))

    # 1) İl adları (uzundan kısaya sırala; 'manisa' 'ani' den önce yakalansın)
    for il_adi in sorted(_PLAKA_NORM, key=len, reverse=True):
        pattern = r"\b" + re.escape(il_adi) + r"\b"
        if re.search(pattern, norm):
            kod = _PLAKA_NORM[il_adi]
            if kod not in bulunan:
                bulunan.append(kod)

    # 2) İlçe adları (yalnızca henüz bir il bulunamadıysa)
    if not bulunan:
        for ilce, kod in _ILCE_IL.items():
            pattern = r"\b" + re.escape(normalize(ilce)) + r"\b"
            if re.search(pattern, norm) and kod not in bulunan:
                bulunan.append(kod)

    return bulunan


def plaka_belirle(kesim_kodu: str, aciklama: str) -> List[int]:
    """
    Sadece açıklama metninden plaka belirler.
    Hiç bulunamazsa [0] döner (bilinmiyor).
    """
    metin_plakalar = plaka_metinden_cikari(aciklama)
    return metin_plakalar if metin_plakalar else [0]


# ===========================================================================
# KGM Sayfa Çekme ve Ayrıştırma
# ===========================================================================

def sayfayi_getir(bolge: int) -> Optional[str]:
    """İstenen bölge numarasının HTML sayfasını döndürür."""
    url = KGM_SAYFA_SABLONU.format(bolge=bolge)
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9",
    }
    try:
        r = requests.get(url, headers=headers, timeout=30)
        r.encoding = "utf-8"
        r.raise_for_status()
        # Bölge yoksa sayfa boş tablo döner veya redirect
        if "Çalışma Yapılan Yollar" not in r.text:
            return None
        return r.text
    except Exception as e:
        print(f"    ⚠️  Bolge={bolge} çekilemedi: {e}")
        return None


def tabloyu_ayristir(html: str, bolge: int) -> List[dict]:
    """
    HTML içindeki çalışma tablosunu ayrıştırıp sözlük listesi döndürür.
    Her sözlük:
        kesim_kodu, aciklama, bildirim_tarihi (str), guncelleme_tarihi (str)
    """
    soup = BeautifulSoup(html, "html.parser")
    satirlar: List[dict] = []
    bolge_url = KGM_SAYFA_SABLONU.format(bolge=bolge)

    # Sayfadaki tüm tablolarda sat satır ara
    for tablo in soup.find_all("table"):
        for satir in tablo.find_all("tr"):
            hucreler = satir.find_all("td")
            if len(hucreler) < 4:
                continue

            # Başlık satırını atla
            ilk = hucreler[0].get_text(strip=True)
            if ilk in ("Yol Kontrol Kesim No", ""):
                continue

            kesim_kodu = hucreler[0].get_text(strip=True)
            aciklama = hucreler[1].get_text(" ", strip=True)
            bildirim = hucreler[2].get_text(strip=True)
            guncelleme = hucreler[3].get_text(strip=True)

            # Tarih verisi olmayan satırları atla
            if not bildirim or not guncelleme:
                continue

            satirlar.append({
                "kesim_kodu": kesim_kodu,
                "aciklama": aciklama,
                "bildirim_tarihi": bildirim,
                "guncelleme_tarihi": guncelleme,
                "bolge": bolge,
                "bolge_url": bolge_url,
            })

    return satirlar


# ===========================================================================
# Tek Satırı İşleme
# ===========================================================================

def satiri_isle(kayit: dict) -> int:
    """
    Tek bir tablo satırını işler; uygun her il için DB kaydı oluşturur/günceller.
    Eklenen/güncellenen kayıt sayısını döndürür.
    """
    kesim_kodu = kayit["kesim_kodu"]
    aciklama = kayit["aciklama"]
    bildirim_str = kayit["bildirim_tarihi"]
    guncelleme_str = kayit["guncelleme_tarihi"]
    bolge = kayit["bolge"]
    bolge_url = kayit["bolge_url"]

    # Tarih dönüşümü
    bildirim_dt = tarih_cevir(bildirim_str)
    guncelleme_dt = tarih_cevir(guncelleme_str)

    if bildirim_dt is None:
        bildirim_dt = datetime.now()
    if guncelleme_dt is None:
        guncelleme_dt = datetime.now()

    bitis_dt = guncelleme_dt + timedelta(days=BITIS_OFFSET_GUN)
    date_str = bildirim_dt.strftime("%d.%m.%Y")

    # Plaka belirleme
    plakalar = plaka_belirle(kesim_kodu, aciklama)

    # Başlık kısaltması (UNIQUE constraint için maks 250 karakter)
    title_base = aciklama
    title = title_base[:250]

    basari = 0
    for plaka in plakalar:
        mesaj_parcalari = [
            f"Yol Kesim No: {kesim_kodu}",
            f"Açıklama: {aciklama}",
            f"Bildirim Tarihi: {bildirim_str}",
            f"Güncelleme Tarihi: {guncelleme_str}",
            f"Bitiş Tarihi: {bitis_dt.strftime('%d.%m.%Y %H:%M')} (tahmini)",
            f"KGM Bölge: {bolge}",
        ]
        if len(plakalar) > 1:
            mesaj_parcalari.append(
                f"Etkili Plaka Kodları: {', '.join(str(p) for p in plakalar)}"
            )

        veri = {
            "valilik_id": plaka,
            "date": date_str,
            "title": title,
            "keywords": ["KGM", "Yol Çalışması", kesim_kodu],
            "link": bolge_url,
            "source_url": KGM_BASE,
            "message": "\n".join(mesaj_parcalari),
            "baslama_zamani": bildirim_dt,
            "bitis_zamani": bitis_dt,
        }

        if kayit_ekle_veya_guncelle(veri):
            basari += 1

    return basari


# ===========================================================================
# Ana Fonksiyon
# ===========================================================================

def main():
    print("KGM ÇALIŞMA YAPILAN YOLLAR TOPLAYICI")
    print("=" * 60)

    # 1. Tablo hazırlığı
    tabloyu_hazirla()

    # 2. Süresi dolmuş kayıtları temizle
    print("\n🧹 Süresi dolmuş kayıtlar temizleniyor...")
    suresi_dolanlari_pasife_al()
    pasif_kayitlari_sil()

    # 3. Bölge sayfalarını tara
    toplam_satir = 0
    toplam_kayit = 0

    for bolge in range(1, MAX_BOLGE + 1):
        url = KGM_SAYFA_SABLONU.format(bolge=bolge)
        print(f"\n{'─'*60}")
        print(f"🔍 Bölge {bolge:2d} taranıyor → {url}")

        html = sayfayi_getir(bolge)
        if html is None:
            print(f"   ℹ️  Sayfa boş veya yok, atlanıyor.")
            continue

        satirlar = tabloyu_ayristir(html, bolge)
        print(f"   📋 {len(satirlar)} kayıt bulundu.")

        if not satirlar:
            continue

        for kayit in satirlar:
            toplam_satir += 1
            eklenen = satiri_isle(kayit)
            toplam_kayit += eklenen

        time.sleep(1)  # sunucuya saygılı olalım

    # 4. Son temizlik
    print(f"\n🧹 İşlem sonrası temizlik...")
    suresi_dolanlari_pasife_al()

    # 5. Özet
    print(f"\n{'='*60}")
    print("🎯 İŞLEM TAMAMLANDI")
    print(f"{'='*60}")
    print(f"📊 Taranan satır sayısı : {toplam_satir}")
    print(f"💾 DB işlemi yapılan    : {toplam_kayit}")


if __name__ == "__main__":
    main()
