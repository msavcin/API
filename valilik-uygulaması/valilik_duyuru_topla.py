import requests
from bs4 import BeautifulSoup
from datetime import datetime
from urllib.parse import urljoin
import json
import psycopg2
from psycopg2 import sql
import os

# --- Ayarları yap ---
start_date = "2025-01-01"  # YYYY-MM-DD
end_date = "2050-12-31"
keywords = ["Orman Yangınları","ORMAN YANGINLARI", "Trafik Tedbirleri"]

start_dt = datetime.strptime(start_date, "%Y-%m-%d")
end_dt = datetime.strptime(end_date, "%Y-%m-%d")
current_year = datetime.now().year

# --- Constants ---
SOURCE_VALILIK = 0  # Valilik Duyuruları
SOURCE_MGM = 1      # MGM Duyuruları

# --- Plaka Numaraları Sözlüğü ---
plaka_kodlari = {
    'adana': 1, 'adiyaman': 2, 'afyonkarahisar': 3, 'agri': 4, 'aksaray': 68,
    'amasya': 5, 'ankara': 6, 'antalya': 7, 'ardahan': 75, 'artvin': 8,
    'aydin': 9, 'balikesir': 10, 'bartin': 74, 'batman': 72, 'bayburt': 69,
    'bilecik': 11, 'bingol': 12, 'bitlis': 13, 'bolu': 14, 'burdur': 15,
    'bursa': 16, 'canakkale': 17, 'cankiri': 18, 'corum': 19, 'denizli': 20,
    'diyarbakir': 21, 'duzce': 81, 'edirne': 22, 'elazig': 23, 'erzincan': 24,
    'erzurum': 25, 'eskisehir': 26, 'gaziantep': 27, 'giresun': 28, 'gumushane': 29,
    'hakkari': 30, 'hatay': 31, 'igdir': 76, 'isparta': 32, 'istanbul': 34,
    'izmir': 35, 'kahramanmaras': 46, 'karabuk': 78, 'karaman': 70, 'kars': 36,
    'kastamonu': 37, 'kayseri': 38, 'kirikkale': 71, 'kirklareli': 39, 'kirsehir': 40,
    'kilis': 79, 'kocaeli': 41, 'konya': 42, 'kutahya': 43, 'malatya': 44,
    'manisa': 45, 'mardin': 47, 'mersin': 33, 'mugla': 48, 'mus': 49,
    'nevsehir': 50, 'nigde': 51, 'ordu': 52, 'osmaniye': 80, 'rize': 53,
    'sakarya': 54, 'samsun': 55, 'siirt': 56, 'sinop': 57, 'sivas': 58,
    'sanliurfa': 63, 'sirnak': 73, 'tekirdag': 59, 'tokat': 60, 'trabzon': 61,
    'tunceli': 62, 'usak': 64, 'van': 65, 'yalova': 77, 'yozgat': 66,
    'zonguldak': 67
}

# --- PostgreSQL Bağlantı Ayarları ---
DB_CONFIG = {
    'host': 'localhost',
    'database': 'kampdefterim',
    'user': 'postgres',
    'password': 's1vc10n',
    'port': '5432'
}

# --- Valilik sayfaları ---
valilikler = {
    "adana": "http://www.adana.gov.tr/duyurular",
    "adiyaman": "http://www.adiyaman.gov.tr/duyurular",
    "afyonkarahisar": "http://www.afyonkarahisar.gov.tr/duyurular",
    "agri": "http://www.agri.gov.tr/duyurular",
    "aksaray": "http://www.aksaray.gov.tr/duyurular",
    "amasya": "http://www.amasya.gov.tr/duyurular",
    "ankara": "http://www.ankara.gov.tr/duyurular",
    "antalya": "http://www.antalya.gov.tr/duyurular",
    "ardahan": "http://www.ardahan.gov.tr/duyurular",
    "artvin": "http://www.artvin.gov.tr/duyurular",
    "aydin": "http://www.aydin.gov.tr/duyurular",
    "balikesir": "http://www.balikesir.gov.tr/duyurular",
    "bartin": "http://www.bartin.gov.tr/duyurular",
    "batman": "http://www.batman.gov.tr/duyurular",
    "bayburt": "http://www.bayburt.gov.tr/duyurular",
    "bilecik": "http://www.bilecik.gov.tr/duyurular",
    "bingol": "http://www.bingol.gov.tr/duyurular",
    "bitlis": "http://www.bitlis.gov.tr/duyurular",
    "bolu": "http://www.bolu.gov.tr/duyurular",
    "burdur": "http://www.burdur.gov.tr/duyurular",
    "bursa": "http://www.bursa.gov.tr/duyurular",
    "canakkale": "http://www.canakkale.gov.tr/duyurular",
    "cankiri": "http://www.cankiri.gov.tr/duyurular",
    "corum": "http://www.corum.gov.tr/duyurular",
    "denizli": "http://www.denizli.gov.tr/duyurular",
    "diyarbakir": "http://www.diyarbakir.gov.tr/duyurular",
    "duzce": "http://www.duzce.gov.tr/duyurular",
    "edirne": "http://www.edirne.gov.tr/duyurular",
    "elazig": "http://www.elazig.gov.tr/duyurular",
    "erzincan": "http://www.erzincan.gov.tr/duyurular",
    "erzurum": "http://www.erzurum.gov.tr/duyurular",
    "eskisehir": "http://www.eskisehir.gov.tr/duyurular",
    "gaziantep": "http://www.gaziantep.gov.tr/duyurular",
    "giresun": "http://www.giresun.gov.tr/duyurular",
    "gumushane": "http://www.gumushane.gov.tr/duyurular",
    "hakkari": "http://www.hakkari.gov.tr/duyurular",
    "hatay": "http://www.hatay.gov.tr/duyurular",
    "igdir": "http://www.igdir.gov.tr/duyurular",
    "isparta": "http://www.isparta.gov.tr/duyurular",
    "istanbul": "http://www.istanbul.gov.tr/genelgeler-ve-kararlar",
    "izmir": "http://www.izmir.gov.tr/duyurular",
    "kahramanmaras": "http://www.kahramanmaras.gov.tr/duyurular",
    "karabuk": "http://www.karabuk.gov.tr/duyurular",
    "karaman": "http://www.karaman.gov.tr/duyurular",
    "kars": "http://www.kars.gov.tr/duyurular",
    "kastamonu": "http://www.kastamonu.gov.tr/duyurular",
    "kayseri": "http://www.kayseri.gov.tr/duyurular",
    "kirikkale": "http://www.kirikkale.gov.tr/duyurular",
    "kirklareli": "http://www.kirklareli.gov.tr/duyurular",
    "kirsehir": "http://www.kirsehir.gov.tr/duyurular",
    "kilis": "http://www.kilis.gov.tr/duyurular",
    "kocaeli": "http://www.kocaeli.gov.tr/duyurular",
    "konya": "http://www.konya.gov.tr/duyurular",
    "kutahya": "http://www.kutahya.gov.tr/duyurular",
    "malatya": "http://www.malatya.gov.tr/duyurular",
    "manisa": "http://www.manisa.gov.tr/duyurular",
    "mardin": "http://www.mardin.gov.tr/duyurular",
    "mersin": "http://www.mersin.gov.tr/duyurular",
    "mugla": "http://www.mugla.gov.tr/duyurular",
    "mus": "http://www.mus.gov.tr/duyurular",
    "nevsehir": "http://www.nevsehir.gov.tr/duyurular",
    "nigde": "http://www.nigde.gov.tr/duyurular",
    "ordu": "http://www.ordu.gov.tr/duyurular",
    "osmaniye": "http://www.osmaniye.gov.tr/duyurular",
    "rize": "http://www.rize.gov.tr/duyurular",
    "sakarya": "http://www.sakarya.gov.tr/duyurular",
    "samsun": "http://www.samsun.gov.tr/duyurular",
    "siirt": "http://www.siirt.gov.tr/duyurular",
    "sinop": "http://www.sinop.gov.tr/duyurular",
    "sivas": "http://www.sivas.gov.tr/duyurular",
    "sanliurfa": "http://www.sanliurfa.gov.tr/duyurular",
    "sirnak": "http://www.sirnak.gov.tr/duyurular",
    "tekirdag": "http://www.tekirdag.gov.tr/duyurular",
    "tokat": "http://www.tokat.gov.tr/duyurular",
    "trabzon": "http://www.trabzon.gov.tr/duyurular",
    "tunceli": "http://www.tunceli.gov.tr/duyurular",
    "usak": "http://www.usak.gov.tr/duyurular",
    "van": "http://www.van.gov.tr/duyurular",
    "yalova": "http://www.yalova.gov.tr/duyurular",
    "yozgat": "http://www.yozgat.gov.tr/duyurular",
    "zonguldak": "http://www.zonguldak.gov.tr/duyurular",
    "aksaray": "http://www.aksaray.gov.tr/duyurular",
    "bayburt": "http://www.bayburt.gov.tr/duyurular",
    "karaman": "http://www.karaman.gov.tr/duyurular",
    "kirikkale": "http://www.kirikkale.gov.tr/duyurular",
    "batman": "http://www.batman.gov.tr/duyurular",
    "sirnak": "http://www.sirnak.gov.tr/duyurular",
    "bartin": "http://www.bartin.gov.tr/duyurular",
    "ardahan": "http://www.ardahan.gov.tr/duyurular",
    "igdir": "http://www.igdir.gov.tr/duyurular",
    "yalova": "http://www.yalova.gov.tr/duyurular",
    "karabuk": "http://www.karabuk.gov.tr/duyurular",
    "kilis": "http://www.kilis.gov.tr/duyurular",
    "osmaniye": "http://www.osmaniye.gov.tr/duyurular",
    "duzce": "http://www.duzce.gov.tr/duyurular"
}

# Ay isimleri
aylar = {
    "Oca": 1, "Şub": 2, "Mar": 3, "Nis": 4, "May": 5, "Haz": 6,
    "Tem": 7, "Ağu": 8, "Eyl": 9, "Eki": 10, "Kas": 11, "Ara": 12
}

# --- Veritabanı Bağlantısı ---
def get_db_connection():
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        conn.autocommit = False
        return conn
    except Exception as e:
        print(f"Veritabanı bağlantı hatası: {e}")
        return None

# --- Veritabanı Tablosu Oluştur ---
def create_table():
    conn = get_db_connection()
    if conn:
        try:
            with conn.cursor() as cur:
                # GÜNCELLENMİŞ tablo yapısı
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
                        aktif BOOLEAN DEFAULT TRUE,
                        UNIQUE(date, title, valilik_id, source)
                    );
                """)

                # Eksik sütunları ekle
                cur.execute("""
                    ALTER TABLE announcements 
                    ADD COLUMN IF NOT EXISTS baslama_zamani TIMESTAMP,
                    ADD COLUMN IF NOT EXISTS bitis_zamani TIMESTAMP,
                    ADD COLUMN IF NOT EXISTS aktif BOOLEAN DEFAULT TRUE;
                """)

                # UNIQUE constraint'i güncelle
                try:
                    cur.execute("ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_date_title_valilik_id_key;")
                except:
                    pass

                try:
                    cur.execute("ALTER TABLE announcements ADD UNIQUE (date, title, valilik_id, source);")
                except:
                    pass

                # Indexleri oluştur
                cur.execute("""
                    CREATE INDEX IF NOT EXISTS idx_announcements_valilik_id 
                    ON announcements(valilik_id);
                """)

                cur.execute("""
                    CREATE INDEX IF NOT EXISTS idx_announcements_source 
                    ON announcements(source);
                """)

                conn.commit()
                print("✅ Veritabanı tablosu MGM ile uyumlu hale getirildi.")
                
        except Exception as e:
            print(f"❌ Tablo oluşturma hatası: {e}")
            conn.rollback()
        finally:
            conn.close()

def eski_valilik_duyurularini_pasif_yap():
    """Valilik duyurularında date + 6 ay geçmişse aktif=false yapar"""
    conn = get_db_connection()
    if conn:
        try:
            with conn.cursor() as cur:
                # Pasife alınacak duyuruları seç
                cur.execute("""
                    SELECT valilik_id, date, title, keywords, source, link, source_url, community_id, message
                    FROM announcements
                    WHERE source = %s
                    AND aktif = TRUE
                    AND (
                        TO_DATE(date, 'DD.MM.YYYY') + INTERVAL '6 months'
                    ) < NOW()
                """, (SOURCE_VALILIK,))
                silinecekler = cur.fetchall()
                # Arşiv dosyasına ekle
                if silinecekler:
                    arsiv_dosya = "silinen_valilik_duyurular.json"
                    try:
                        with open(arsiv_dosya, "r", encoding="utf-8") as f:
                            arsiv = json.load(f)
                    except:
                        arsiv = []
                    for row in silinecekler:
                        arsiv.append({
                            "valilik_id": row[0],
                            "date": row[1],
                            "title": row[2],
                            "keywords": row[3],
                            "source": row[4],
                            "link": row[5],
                            "source_url": row[6],
                            "community_id": row[7],
                            "message": row[8]
                        })
                    with open(arsiv_dosya, "w", encoding="utf-8") as f:
                        json.dump(arsiv, f, ensure_ascii=False, indent=2)
                # Sonra pasife al
                cur.execute("""
                    UPDATE announcements
                    SET aktif = FALSE, updated_at = NOW()
                    WHERE source = %s
                    AND aktif = TRUE
                    AND (
                        TO_DATE(date, 'DD.MM.YYYY') + INTERVAL '6 months'
                    ) < NOW()
                """, (SOURCE_VALILIK,))
                print(f"Valilik duyurularında eski kayıtlar arşive alındı ve pasife alındı.")
                conn.commit()
        except Exception as e:
            print(f"Valilik duyurularını pasife alma hatası: {e}")
            conn.rollback()
        finally:
            conn.close()

# --- Pasif duyuruları veritabanından sil ---
def pasif_valilik_duyurularini_sil():
    """Aktif=false olan valilik duyurularını veritabanından siler."""
    conn = get_db_connection()
    if conn:
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    DELETE FROM announcements
                    WHERE source = %s AND aktif = FALSE
                """, (SOURCE_VALILIK,))
                print("Pasif valilik duyuruları veritabanından silindi.")
                conn.commit()
        except Exception as e:
            print(f"Pasif duyuruları silme hatası: {e}")
            conn.rollback()
        finally:
            conn.close()

# --- Duyuruyu Veritabanına Kaydet ---
def duyuru_kaydet(duyuru_bilgisi):
    # Önce arşiv dosyasını kontrol et
    arsiv_dosya = "silinen_valilik_duyurular.json"
    try:
        with open(arsiv_dosya, "r", encoding="utf-8") as f:
            arsiv = json.load(f)
    except:
        arsiv = []
    # Arşivde aynı duyuru varsa ekleme (tip ve içerik eşleşmesiyle)
    for kayit in arsiv:
        if (str(kayit.get('valilik_id')) == str(duyuru_bilgisi.get('valilik_id')) and
            str(kayit.get('date')) == str(duyuru_bilgisi.get('date')) and
            str(kayit.get('title')).strip() == str(duyuru_bilgisi.get('title')).strip() and
            int(kayit.get('source', SOURCE_VALILIK)) == int(duyuru_bilgisi.get('source', SOURCE_VALILIK))):
            print(f"⏩ Silinmiş/pasif duyuru tekrar eklenmiyor: {duyuru_bilgisi['title'][:50]}...")
            return False

    conn = get_db_connection()
    if conn:
        try:
            with conn.cursor() as cur:
                # ON CONFLICT ile ekle/güncelle
                cur.execute("""
                    INSERT INTO announcements 
                    (valilik_id, date, title, keywords, source, link, source_url, 
                     islenme_tarihi, community_id, message, baslama_zamani, bitis_zamani, aktif)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (date, title, valilik_id, source) 
                    DO UPDATE SET
                        keywords = EXCLUDED.keywords,
                        link = EXCLUDED.link,
                        source_url = EXCLUDED.source_url,
                        islenme_tarihi = EXCLUDED.islenme_tarihi,
                        message = EXCLUDED.message,
                        updated_at = NOW()
                    RETURNING id
                """, (
                    duyuru_bilgisi['valilik_id'],
                    duyuru_bilgisi['date'],
                    duyuru_bilgisi['title'],
                    json.dumps(duyuru_bilgisi['keywords']),
                    SOURCE_VALILIK,  # Sabit: 0 (Valilik)
                    duyuru_bilgisi['link'],
                    duyuru_bilgisi['source_url'],
                    datetime.now(),  # islenme_tarihi
                    duyuru_bilgisi.get('community_id', 0),
                    duyuru_bilgisi.get('message', ''),
                    None,  # baslama_zamani - BOŞ
                    None,  # bitis_zamani - BOŞ
                    True   # aktif - TRUE
                ))

                result = cur.fetchone()
                conn.commit()
                
                if result:
                    print(f"✅ Duyuru kaydedildi/güncellendi (ID: {result[0]}): {duyuru_bilgisi['title'][:50]}...")
                return True
                    
        except Exception as e:
            print(f"❌ Duyuru kaydetme hatası: {e}")
            conn.rollback()
            return False
        finally:
            conn.close()
    return False

# --- Tarih İşleme Fonksiyonu ---
def tarih_isle(day_element, month_element):
    # ... (Aynı kalsın)
    duyuru_date = None
    tarih_str = "Tarih bilgisi yok"
    formatted_date = "01.01.2025"
    
    if day_element and month_element:
        day = day_element.text.strip()
        month_text = month_element.text.strip()
        
        try:
            parts = month_text.split()
            if len(parts) == 2:
                month_str, year_str = parts
                month = aylar.get(month_str[:3])
                if month:
                    year = int(year_str)
                    day_int = int(day)
                    duyuru_date = datetime(year, month, day_int)
                    formatted_date = duyuru_date.strftime("%d.%m.%Y")
                    tarih_str = f"{day} {month_text}"
                else:
                    month = aylar.get(month_str[:3], 1)
                    day_int = int(day) if day.isdigit() else 1
                    duyuru_date = datetime(current_year, month, day_int)
                    formatted_date = duyuru_date.strftime("%d.%m.%Y")
                    tarih_str = f"{day} {month_text} {current_year}"
            else:
                month_str = month_text
                month = aylar.get(month_str[:3], 1)
                day_int = int(day) if day.isdigit() else 1
                duyuru_date = datetime(current_year, month, day_int)
                formatted_date = duyuru_date.strftime("%d.%m.%Y")
                tarih_str = f"{day} {month_text} {current_year}"
        except Exception as e:
            day_int = int(day) if day.isdigit() else 1
            duyuru_date = datetime(current_year, 1, day_int)
            formatted_date = duyuru_date.strftime("%d.%m.%Y")
            tarih_str = f"{day} {month_text} {current_year}"
    
    elif day_element:
        day = day_element.text.strip()
        day_int = int(day) if day.isdigit() else 1
        duyuru_date = datetime(current_year, 1, day_int)
        formatted_date = duyuru_date.strftime("%d.%m.%Y")
        tarih_str = f"{day} Ocak {current_year}"
    
    elif month_element:
        month_text = month_element.text.strip()
        month = aylar.get(month_text[:3], 1)
        duyuru_date = datetime(current_year, month, 1)
        formatted_date = duyuru_date.strftime("01.%m.%Y")
        tarih_str = f"01 {month_text} {current_year}"
    
    else:
        duyuru_date = datetime.now()
        formatted_date = duyuru_date.strftime("%d.%m.%Y")
        tarih_str = "Tarih bilgisi yok"
    
    return duyuru_date, tarih_str, formatted_date

# --- Ana İşlem ---
def main():
    print("VALİLİK DUYURU TOPLAYICI (MGM UYUMLU)")
    print("=" * 60)
    
    # Tabloyu oluştur
    create_table()
    # 1. 6 ayı dolanları pasife al ve arşive ekle
    eski_valilik_duyurularini_pasif_yap()
    # 2. Pasif duyuruları veritabanından sil
    pasif_valilik_duyurularini_sil()
    
    tum_duyurular = []
    kaydedilen_duyurular = 0
    toplam_duyuru_sayisi = 0
    
    # --- Tüm valilikleri gez ---
    for valilik_adi, base_url in valilikler.items():
        if valilik_adi not in plaka_kodlari:
            continue
            
        valilik_id = plaka_kodlari[valilik_adi]
        print(f"\n🔍 {valilik_adi.upper()} Valiliği ({valilik_id}) Taranıyor...")
        
        try:
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
            res = requests.get(base_url, headers=headers, timeout=30)
            res.raise_for_status()
            
            soup = BeautifulSoup(res.text, 'html.parser')
            duyurular = soup.select("div.ministry-announcements")
            
            if not duyurular:
                print(f"ℹ️  Duyuru bulunamadı")
                continue

            print(f"📋 {len(duyurular)} duyuru bulundu")

            for i, duyuru in enumerate(duyurular, 1):
                try:
                    # Tarih bilgilerini al
                    day_element = duyuru.select_one("div.day")
                    month_element = duyuru.select_one("div.month")
                    
                    # Tarihi işle
                    duyuru_date, tarih_str, formatted_date = tarih_isle(day_element, month_element)

                    # Tarih filtresi
                    if duyuru_date and not (start_dt <= duyuru_date <= end_dt):
                        continue

                    # Başlık and link
                    a_tag = duyuru.select_one("a.announce-text")
                    if not a_tag:
                        continue
                        
                    title = a_tag.text.strip()
                    link = a_tag.get('href', '')
                    
                    # Linki tamamla
                    if link and not link.startswith("http"):
                        link = urljoin(base_url, link)

                    # Anahtar kelime filtresi
                    title_lower = title.lower()
                    keywords_lower = [k.lower() for k in keywords]
                    matched_keywords = [k for k in keywords_lower if k in title_lower]
                    
                    if matched_keywords:
                        toplam_duyuru_sayisi += 1
                        
                        # Duyuru bilgilerini hazırla
                        duyuru_bilgisi = {
                            'valilik_id': valilik_id,
                            'date': formatted_date,
                            'title': title,
                            'keywords': matched_keywords,
                            'link': link,
                            'source_url': base_url,
                            'community_id': 0,
                            'message': f"Kaynak: {valilik_adi.upper()} Valiliği\nTarih: {tarih_str}"
                        }

                        tum_duyurular.append(duyuru_bilgisi)

                        # Veritabanına kaydet
                        if duyuru_kaydet(duyuru_bilgisi):
                            kaydedilen_duyurular += 1

                except Exception as e:
                    print(f"❌ {i}. Duyuru işlenirken hata: {e}")
                    continue

        except Exception as e:
            print(f"❌ {valilik_adi} hatası: {e}")

    # --- Sonuçları Göster ---
    print("\n" + "=" * 60)
    print("🎯 İŞLEM TAMAMLANDI")
    print("=" * 60)
    print(f"📊 Toplam Duyuru: {toplam_duyuru_sayisi}")
    print(f"💾 Veritabanına Kaydedilen: {kaydedilen_duyurular}")
    print(f"⏩ Zaten Mevcut: {toplam_duyuru_sayisi - kaydedilen_duyurular}")

    # --- JSON kaydet ---
    if tum_duyurular:
        json_dosya = "valilik_duyurular.json"
        with open(json_dosya, "w", encoding="utf-8") as f:
            json.dump(tum_duyurular, f, ensure_ascii=False, indent=4)
        print(f"\n💾 JSON kaydedildi: {json_dosya}")

# Programı çalıştır
if __name__ == "__main__":
    main()