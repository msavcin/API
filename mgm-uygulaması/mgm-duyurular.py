import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin
import pandas as pd
import time
import re
import psycopg2
from datetime import datetime, timedelta
import json
import sys
from datetime import datetime, timedelta
import pytz
from datetime import datetime, timezone, timedelta
import pytz

# Selenium'u kontrol et ve yoksa kur
try:
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.common.by import By
except ImportError:
    print("Selenium kurulu değil. Kuruluyor...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "selenium"])
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.common.by import By

# MGM base URL
BASE_URL = "https://www.mgm.gov.tr/"

# --- PostgreSQL Bağlantı Ayarları ---
DB_CONFIG = {
    'host': 'localhost',
    'database': 'kampdefterim',
    'user': 'postgres',
    'password': 's1vc10n',
    'port': '5432'
}

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

def get_istanbul_time():
    """Europe/Istanbul timezone'unda zaman al"""
    # Yöntem 1: pytz ile
    try:
        istanbul_tz = pytz.timezone('Europe/Istanbul')
        return datetime.now(istanbul_tz)
    except:
        pass
    
    # Yöntem 2: Manuel offset ile (UTC+3)
    utc_now = datetime.now(timezone.utc)
    istanbul_offset = timedelta(hours=3)
    return utc_now + istanbul_offset

# Kullanım
current_time = get_istanbul_time()
print(f"İstanbul zamanı: {current_time}")

def veritabani_baglantisi():
    """PostgreSQL veritabanı bağlantısı oluştur"""
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        return conn
    except Exception as e:
        print(f"Veritabanı bağlantı hatası: {e}")
        return None

def mevcut_kayit_sayisi():
    """Mevcut kayıt sayısını göster"""
    conn = veritabani_baglantisi()
    if conn is None:
        return 0

    try:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM announcements")
        count = cursor.fetchone()[0]
        cursor.close()
        conn.close()
        return count
    except:
        return 0

def tabloyu_kontrol_et_ve_guncelle():
    """Tabloyu kontrol et ve belirtilen yapıya göre oluştur/güncelle"""
    conn = veritabani_baglantisi()
    if conn is None:
        return False

    try:
        cursor = conn.cursor()

        # Önce tablo var mı kontrol et
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'announcements'
            );
        """)
        tablo_var = cursor.fetchone()[0]

        if not tablo_var:
            # Tablo yoksa belirtilen yapıya göre oluştur
            create_table_query = """
            CREATE TABLE announcements (
                id SERIAL PRIMARY KEY,
                valilik_id INTEGER NOT NULL,
                date VARCHAR(10) NOT NULL,
                title TEXT NOT NULL,
                keywords JSONB,
                source INTEGER DEFAULT 1, -- 1: MGM
                link TEXT NOT NULL,
                source_url TEXT NOT NULL,
                islenme_tarihi TIMESTAMP NOT NULL,
                community_id INTEGER DEFAULT 0,
                message TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                baslama_zamani TIMESTAMP,
                bitis_zamani TIMESTAMP,
                aktif BOOLEAN DEFAULT TRUE,
                UNIQUE(date, title, valilik_id)  -- Aynı tarih, başlık ve valilik_id'den sadece bir tane olabilir
            )
            """
            cursor.execute(create_table_query)
            print("✅ Tablo belirtilen yapıya göre oluşturuldu")
        else:
            # Tablo varsa sütunları kontrol et
            print("✅ Tablo zaten mevcut, yapı kontrol ediliyor...")

            # Gerekli sütunları kontrol et ve ekle
            columns_to_check = [
                ('valilik_id', 'INTEGER NOT NULL'),
                ('date', 'VARCHAR(10) NOT NULL'),
                ('title', 'TEXT NOT NULL'),
                ('keywords', 'JSONB'),
                ('source', 'INTEGER DEFAULT 1'),
                ('link', 'TEXT NOT NULL'),
                ('source_url', 'TEXT NOT NULL'),
                ('islenme_tarihi', 'TIMESTAMP NOT NULL'),
                ('community_id', 'INTEGER DEFAULT 0'),
                ('message', "TEXT DEFAULT ''"),
                ('created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP'),
                ('baslama_zamani', 'TIMESTAMP'),
                ('bitis_zamani', 'TIMESTAMP'),
                ('aktif', 'BOOLEAN DEFAULT TRUE')
            ]

            for column_name, column_type in columns_to_check:
                try:
                    cursor.execute(f"ALTER TABLE announcements ADD COLUMN IF NOT EXISTS {column_name} {column_type}")
                    print(f"✅ {column_name} sütunu kontrol edildi")
                except Exception as e:
                    print(f"{column_name} sütunu hatası: {e}")

            # UNIQUE constraint ekle (date, title, valilik_id)
            try:
                cursor.execute("""
                    DO $$
                    BEGIN
                        IF NOT EXISTS (
                            SELECT 1 FROM pg_constraint
                            WHERE conname = 'announcements_date_title_valilik_id_key'
                        ) THEN
                            ALTER TABLE announcements ADD UNIQUE (date, title, valilik_id);
                        END IF;
                    END $$;
                """)
                print("✅ UNIQUE constraint kontrol edildi")
            except Exception as e:
                print(f"UNIQUE constraint hatası: {e}")

        conn.commit()
        cursor.close()
        conn.close()
        return True

    except Exception as e:
        print(f"Tablo kontrol hatası: {e}")
        return False

def tarih_cevir(tarih_metni):
    """Tarih ve saat metnini datetime objesine çevir"""
    try:
        tarih_metni = tarih_metni.strip()
        print(f"    🔍 Tarih çeviriliyor: '{tarih_metni}'")
        
        # "18.00" formatını "18:00" formatına çevir
        if re.search(r'\d{1,2}\.\d{2}$', tarih_metni) and len(tarih_metni.split()) == 2:
            parts = tarih_metni.split()
            parts[1] = parts[1].replace('.', ':')
            tarih_metni = ' '.join(parts)
            print(f"    🔧 Format düzeltildi: '{tarih_metni}'")
        
        # Farklı formatları dene
        formats = [
            '%d.%m.%Y %H:%M',  # "06.10.2025 18:00"
            '%d.%m.%Y %H.%M',  # "06.10.2025 18.00"  
            '%d/%m/%Y %H:%M',  # "06/10/2025 18:00"
            '%d/%m/%Y %H.%M',  # "06/10/2025 18.00"
            '%d.%m.%Y',        # "06.10.2025"
            '%d/%m/%Y',        # "06/10/2025"
        ]
        
        for fmt in formats:
            try:
                result = datetime.strptime(tarih_metni, fmt)
                print(f"    ✅ Tarih çevrildi: {result} (format: {fmt})")
                return result
            except ValueError:
                continue
        
        print(f"⚠️  Tarih formatı tanınamadı: {tarih_metni}")
        return None
        
    except Exception as e:
        print(f"❌ Tarih çevirme hatası: {e}")
        return None

def baslama_bitis_zamani_ayir(zaman_metni):
    """Başlama-Bitiş Zamanı metnini ayır ve datetime objelerine çevir"""
    try:
        print(f"    🔍 Zaman metni analiz ediliyor: '{zaman_metni}'")
        zaman_metni = zaman_metni.strip()

        # Hem kısa hem uzun formatları destekle
        # Örnek: "30.12.2025 21:00 - 05.01.2026 09:00" veya "06.10.2025 18.00-07.10.2025 23.00"
        # Tire çevresinde boşluk olabileceği için regex ile ayır
        match = re.match(r"(.+?)\s*-\s*(.+)", zaman_metni)
        if match:
            baslama_metni = match.group(1).strip()
            bitis_metni = match.group(2).strip()
            print(f"    📅 Başlama metni: '{baslama_metni}'")
            print(f"    📅 Bitiş metni: '{bitis_metni}'")
            baslama_zamani = tarih_cevir(baslama_metni)
            bitis_zamani = tarih_cevir(bitis_metni)
            if baslama_zamani and bitis_zamani:
                return baslama_zamani, bitis_zamani

        print(f"⚠️  Zaman formatı tanınamadı: {zaman_metni}")
        return None, None
    except Exception as e:
        print(f"❌ Zaman ayırma hatası: {e}")
        return None, None

def uyari_detay_cek(url):
    """Uyarı detaylarını çek"""
    try:
        print(f"Detay çekiliyor: {url}")
        response = requests.get(url, timeout=10)
        response.raise_for_status()

        soup = BeautifulSoup(response.content, 'html.parser')

        detaylar = {}
        baslama_zamani = None
        bitis_zamani = None

        # Ana başlık
        baslik = soup.find('h2')
        if baslik:
            detaylar['uyari_turu'] = baslik.get_text(strip=True)

        # Tarih ve saat bilgileri
        zaman_div = soup.find('p', class_='uZaman')
        if zaman_div:
            detaylar['tarih_saat'] = zaman_div.get_text(strip=True)

            # Tarih bilgisini parse et (VARCHAR(10) formatında)
            tarih_metni = detaylar['tarih_saat']
            tarih_match = re.search(r'(\d{1,2}\s+\w+\s+\d{4})', tarih_metni)
            if tarih_match:
                # Tarihi "DD.MM.YYYY" formatına çevir
                tarih_parcalar = tarih_match.group(1).split()
                gun = tarih_parcalar[0].zfill(2)
                ay_ismi = tarih_parcalar[1].lower()
                yil = tarih_parcalar[2]

                # Ay ismini sayıya çevir
                ay_cevirme = {
                    'ocak': '01', 'şubat': '02', 'mart': '03', 'nisan': '04',
                    'mayıs': '05', 'haziran': '06', 'temmuz': '07', 'ağustos': '08',
                    'eylül': '09', 'ekim': '10', 'kasım': '11', 'aralık': '12'
                }

                ay = ay_cevirme.get(ay_ismi, '01')
                detaylar['tarih'] = f"{gun}.{ay}.{yil}"

        # Uyarı başlığı
        uyari_baslik = soup.find('p').find_next_sibling('p')
        if uyari_baslik and uyari_baslik.find('b'):
            detaylar['uyari_baslik'] = uyari_baslik.get_text(strip=True)

        # Detaylı bilgileri çek - TÜM içeriği debug edelim
        uyari_icerik = {}
        
        print("    🔍 Tüm içerik taranıyor...")
        
        # Önce tüm metinleri görelim
        tum_metin = soup.get_text()
        print("    📄 Sayfa içeriği:")
        for line in tum_metin.split('\n'):
            line = line.strip()
            if line and any(keyword in line.lower() for keyword in ['başlama', 'bitiş', 'zamanı', 'yer', 'etkili']):
                print(f"      {line}")
        
        # Tüm h3 başlıklarını bul
        tum_basliklar = soup.find_all(['h3', 'strong', 'b'])
        
        for baslik_element in tum_basliklar:
            baslik_text = baslik_element.get_text(strip=True)
            
            # Başlama-Bitiş Zamanı'nı ara
            if 'başlama' in baslik_text.lower() and 'bitiş' in baslik_text.lower():
                print(f"    🎯 BAŞLAMA-BİTİŞ BULUNDU: {baslik_text}")
                
                # İçeriği bul
                icerik_element = None
                
                # Sonraki p etiketini dene
                icerik_element = baslik_element.find_next_sibling('p')
                if not icerik_element:
                    # Sonraki div etiketini dene
                    icerik_element = baslik_element.find_next_sibling('div')
                if not icerik_element:
                    # Sonraki span etiketini dene
                    icerik_element = baslik_element.find_next_sibling('span')
                if not icerik_element:
                    # Bir sonraki element ne olursa olsun al
                    next_element = baslik_element.next_sibling
                    while next_element and not getattr(next_element, 'text', '').strip():
                        next_element = next_element.next_sibling
                    icerik_element = next_element
                
                if icerik_element:
                    icerik_text = icerik_element.get_text(strip=True)
                    print(f"    📋 Zaman içeriği: '{icerik_text}'")
                    
                    uyari_icerik[baslik_text] = icerik_text
                    
                    # Zamanı ayrıştır
                    baslama_zamani, bitis_zamani = baslama_bitis_zamani_ayir(icerik_text)
                    break

        detaylar['detaylar'] = uyari_icerik
        detaylar['baslama_zamani'] = baslama_zamani
        detaylar['bitis_zamani'] = bitis_zamani

        return detaylar

    except Exception as e:
        print(f"❌ Detay çekme hatası: {e}")
        return {'hata': f"İçerik çekilemedi: {str(e)}"}

def veritabanina_yaz(valilik_id, date, title, keywords, link, source_url, message, baslama_zamani=None, bitis_zamani=None):
    """Veritabanına kayıt ekle"""
    conn = veritabani_baglantisi()
    if conn is None:
        return False


    try:
        cursor = conn.cursor()

        # Önce bu kayıt zaten var mı kontrol et (hem link+valilik_id, hem eski UNIQUE için)
        cursor.execute("""
            SELECT id, bitis_zamani, aktif FROM announcements
            WHERE link = %s AND valilik_id::integer = %s
        """, (link, int(valilik_id)))

        existing_record = cursor.fetchone()

        if existing_record:
            print(f"    ⚠️  Bu link ve valilik_id ile kayıt zaten mevcut (ID: {existing_record[0]}), sadece güncellenecek...")
            su_an = datetime.now()
            yeni_aktif = True
            if bitis_zamani and bitis_zamani < su_an:
                yeni_aktif = False
                print(f"    🔴 Kayıt pasif hale getirilecek (bitiş: {bitis_zamani})")
            else:
                print(f"    🟢 Kayıt aktif kalacak (bitiş: {bitis_zamani})")
            update_query = """
            UPDATE announcements 
            SET keywords = %s, date = %s, title = %s, source_url = %s, message = %s, 
                islenme_tarihi = %s, baslama_zamani = %s, bitis_zamani = %s, aktif = %s
            WHERE id = %s
            """
            cursor.execute(update_query, (
                json.dumps(keywords) if keywords else None,
                date,
                title,
                source_url,
                message,
                datetime.now(),
                baslama_zamani,
                bitis_zamani,
                yeni_aktif,
                existing_record[0]
            ))
            conn.commit()
            cursor.close()
            conn.close()
            print(f"    ✅ Mevcut kayıt güncellendi (Aktif: {yeni_aktif})")
            return True

        # Eğer aynı link ve valilik_id ile kayıt yoksa yeni kayıt ekle
        insert_query = """
        INSERT INTO announcements
        (valilik_id, date, title, keywords, link, source, source_url, message, islenme_tarihi, community_id, baslama_zamani, bitis_zamani, aktif)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """

        su_an = datetime.now()
        aktif = True
        if bitis_zamani:
            if bitis_zamani < su_an:
                aktif = False
                print(f"    🔴 Yeni kayıt pasif olarak eklenecek (bitiş: {bitis_zamani})")
            else:
                print(f"    🟢 Yeni kayıt aktif olarak eklenecek (bitiş: {bitis_zamani})")
        else:
            print(f"    🟡 Yeni kayıt aktif olarak eklenecek (bitiş zamanı yok)")

        print(f"    🗄️  Veritabanına yazılıyor:")
        print(f"      valilik_id: {valilik_id}")
        print(f"      date: {date}")
        print(f"      baslama_zamani: {baslama_zamani}")
        print(f"      bitis_zamani: {bitis_zamani}")
        print(f"      aktif: {aktif}")
        print(f"      şu anki zaman: {su_an}")

        cursor.execute(insert_query, (
            valilik_id,
            date,
            title,
            json.dumps(keywords) if keywords else None,
            link,
            1, # source = 1 (MGM)
            source_url,
            message,
            datetime.now(),  # islenme_tarihi
            0,  # community_id
            baslama_zamani,
            bitis_zamani,
            aktif
        ))

        conn.commit()
        cursor.close()
        conn.close()
        print("    ✅ Veritabanına kayıt eklendi")
        return True

    except Exception as e:
        print(f"❌ Veritabanı yazma hatası: {e}")
        import traceback
        print(f"🔍 Hata detayı: {traceback.format_exc()}")
        return False

def eski_duyurulari_temizle():
    """Bitiş zamanı geçmiş duyuruları temizle"""
    conn = veritabani_baglantisi()
    if conn is None:
        return 0

    try:
        cursor = conn.cursor()
        
        # Şu anki zamanı al ve debug için yazdır
        su_an = get_istanbul_time()
        print(f"    🕒 Şu anki zaman: {su_an}")
        
        # Bitiş zamanı geçmiş ve hala aktif olan kayıtları bul
        cursor.execute("""
            SELECT id, title, bitis_zamani 
            FROM announcements 
            WHERE bitis_zamani IS NOT NULL 
            AND bitis_zamani < %s 
            AND aktif = TRUE
        """, (su_an,))
        
        eski_kayitlar = cursor.fetchall()
        
        if eski_kayitlar:
            print(f"    🕒 {len(eski_kayitlar)} adet süresi dolmuş duyuru bulundu:")
            for kayit in eski_kayitlar:
                print(f"       - ID: {kayit[0]}, Başlık: {kayit[1][:50]}, Bitiş: {kayit[2]}")
            
            # Aktif durumunu false yap
            cursor.execute("""
                UPDATE announcements 
                SET aktif = FALSE 
                WHERE bitis_zamani IS NOT NULL 
                AND bitis_zamani < %s 
                AND aktif = TRUE
            """, (su_an,))
            
            conn.commit()
            print(f"    ✅ {len(eski_kayitlar)} adet duyuru pasif hale getirildi")
        else:
            print("    ℹ️  Süresi dolmuş duyuru bulunamadı")
            
        cursor.close()
        conn.close()
        return len(eski_kayitlar)
        
    except Exception as e:
        print(f"❌ Eski duyuruları temizleme hatası: {e}")
        import traceback
        print(f"🔍 Hata detayı: {traceback.format_exc()}")
        return 0

def il_isimlerini_bul_ve_plakaya_cevir(metin):
    """Metin içindeki il isimlerini ve özel bölge anahtar kelimelerini bulup plaka numaralarına çevirir"""
    bulunan_iller = []
    plaka_numaralari = []

    # Özel bölge anahtar kelimeleri ve karşılık gelen iller
    bolge_eslesmeleri = [
        {
            'anahtarlar': ["kuzey ege"],
            'iller': ["canakkale", "balikesir", "izmir"]
        },
        {
            'anahtarlar': ["batı karadeniz"],
            'iller': ["bolu", "kastamonu", "sinop", "zonguldak", "bartin", "karabuk", "duzce"]
        },
        {
            'anahtarlar': ["doğu karadeniz"],
            'iller': ["artvin", "bayburt", "giresun", "gumushane", "ordu", "rize", "samsun", "trabzon"]
        },
        {
            'anahtarlar': ["marmara"],
            'iller': ["istanbul", "tekirdag", "edirne", "kirklareli", "balikesir", "canakkale", "bursa", "bilecik", "sakarya", "kocaeli", "yalova"]
        },
        # Yeni bölge tanımlamaları buraya eklenebilir
        # {
        #     'anahtarlar': ["güney marmara"],
        #     'iller': ["balikesir", "bursa", "canakkale", "tekirdag", "yalova"]
        # },
    ]

    metin_lower = metin.lower()

    # Önce özel bölge anahtar kelimelerini kontrol et
    for bolge in bolge_eslesmeleri:
        for anahtar in bolge['anahtarlar']:
            if anahtar in metin_lower:
                for il in bolge['iller']:
                    if il not in bulunan_iller:
                        bulunan_iller.append(il.capitalize())
                        plaka_numaralari.append(plaka_kodlari[il])
                # Aynı anahtar birden fazla kez eklenmesin diye break
                break

    # Sonra klasik il isimlerini ara (varsa)
    for il, plaka in plaka_kodlari.items():
        if il == 'istanbul':
            patterns = [r'\bistanbul\b', r'\bi̇stanbul\b']
        else:
            il_pattern = il.replace('i', '[iı]').replace('g', '[gğ]').replace('u', '[uü]').replace('s', '[sş]').replace('o', '[oö]').replace('c', '[cç]')
            patterns = [r'\b' + il_pattern + r'\b']

        for pattern in patterns:
            if re.search(pattern, metin_lower, re.IGNORECASE):
                orijinal_pattern = pattern.replace(r'\b', '').replace('[iı]', '[iıİI]').replace('[gğ]', '[gğĞG]').replace('[uü]', '[uüÜU]').replace('[sş]', '[sşŞS]').replace('[oö]', '[oöÖO]').replace('[cç]', '[cçÇC]')
                orijinal_il_eslesme = re.search(r'\b' + orijinal_pattern + r'\b', metin, re.IGNORECASE)

                if orijinal_il_eslesme:
                    bulunan_il = orijinal_il_eslesme.group()
                    # Eğer bu il zaten eklenmediyse ekle
                    if bulunan_il.lower() not in [b.lower() for b in bulunan_iller]:
                        bulunan_iller.append(bulunan_il)
                        plaka_numaralari.append(plaka)
                break

    return bulunan_iller, plaka_numaralari

def mgm_selenium_ile_cek():
    """Selenium ile MGM'den uyarı linklerini çek"""
    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options

        chrome_options = Options()
        chrome_options.add_argument('--headless')
        chrome_options.add_argument('--no-sandbox')
        chrome_options.add_argument('--disable-dev-shm-usage')

        print("Chrome driver başlatılıyor...")
        driver = webdriver.Chrome(options=chrome_options)

        print("MGM sitesine gidiliyor...")
        driver.get(BASE_URL)

        time.sleep(5)

        alarm_div = driver.find_element("id", "mainAlarm")
        uyari_linkleri = alarm_div.find_elements("css selector", "a.announcement")

        uyarilar = []

        for link in uyari_linkleri:
            try:
                href = link.get_attribute("href")
                tip_element = link.find_element("css selector", "span.month")
                tip = tip_element.text.strip()
                baslik_element = link.find_element("css selector", "div.title")
                baslik = baslik_element.text.strip()

                uyarilar.append({
                    'tip': tip,
                    'baslik': baslik,
                    'link': href
                })

                print(f"Bulundu: {tip} - {baslik}")

            except Exception as e:
                print(f"Link işlenirken hata: {e}")
                continue

        driver.quit()
        return uyarilar

    except Exception as e:
        print(f"Selenium hatası: {e}")
        try:
            driver.quit()
        except:
            pass
        return []

def uyari_detay_cek(url):
    """Uyarı detaylarını çek"""
    try:
        print(f"Detay çekiliyor: {url}")
        response = requests.get(url, timeout=10)
        response.raise_for_status()

        soup = BeautifulSoup(response.content, 'html.parser')

        detaylar = {}
        baslama_zamani = None
        bitis_zamani = None
        uyari_icerik = {}

        # Ana başlık
        baslik = soup.find('h2')
        if baslik:
            detaylar['uyari_turu'] = baslik.get_text(strip=True)
            print(f"    📌 Uyarı Türü: {detaylar['uyari_turu']}")

        # Tarih ve saat bilgileri
        zaman_div = soup.find('p', class_='uZaman')
        if zaman_div:
            detaylar['tarih_saat'] = zaman_div.get_text(strip=True)
            print(f"    📅 Tarih/Saat: {detaylar['tarih_saat']}")

            # Tarih bilgisini parse et
            tarih_metni = detaylar['tarih_saat']
            tarih_match = re.search(r'(\d{1,2}\s+\w+\s+\d{4})', tarih_metni)
            if tarih_match:
                tarih_parcalar = tarih_match.group(1).split()
                gun = tarih_parcalar[0].zfill(2)
                ay_ismi = tarih_parcalar[1].lower()
                yil = tarih_parcalar[2]

                ay_cevirme = {
                    'ocak': '01', 'şubat': '02', 'mart': '03', 'nisan': '04',
                    'mayıs': '05', 'haziran': '06', 'temmuz': '07', 'ağustos': '08',
                    'eylül': '09', 'ekim': '10', 'kasım': '11', 'aralık': '12'
                }

                ay = ay_cevirme.get(ay_ismi, '01')
                detaylar['tarih'] = f"{gun}.{ay}.{yil}"
                print(f"    📆 Formatlı Tarih: {detaylar['tarih']}")

        # BAŞLAMA-BİTİŞ ZAMANINI BUL
        print("    🔍 Başlama-Bitiş zamanı aranıyor...")
        
        # Tüm R class'lı div'leri bul
        r_divs = soup.find_all('div', class_='R')
        
        for r_div in r_divs:
            # c1 class'lı div içindeki h3 başlığını al
            c1_div = r_div.find('div', class_='c1')
            if c1_div:
                h3_baslik = c1_div.find('h3')
                if h3_baslik:
                    baslik_text = h3_baslik.get_text(strip=True)
                    
                    # Aynı R div içindeki c2 div'ini bul
                    c2_div = r_div.find('div', class_='c2')
                    if c2_div:
                        icerik_p = c2_div.find('p')
                        if icerik_p:
                            icerik_text = icerik_p.get_text(strip=True)
                            uyari_icerik[baslik_text] = icerik_text
                            
                            print(f"    📋 {baslik_text}: {icerik_text}")
                            
                            # Başlama-Bitiş Zamanı
                            if 'Başlama-Bitiş Zamanı' in baslik_text:
                                baslama_zamani, bitis_zamani = baslama_bitis_zamani_ayir(icerik_text)
                            
                            # Beklendiği Yer - İL BİLGİSİ BURADA!
                            elif 'Beklendiği Yer' in baslik_text:
                                iller, plakalar = il_isimlerini_bul_ve_plakaya_cevir(icerik_text)
                                uyari_icerik['Beklendiği Yer İller'] = iller
                                uyari_icerik['Beklendiği Yer Plaka Kodları'] = plakalar
                                print(f"    📍 Bulunan iller: {iller}")
                                print(f"    🔢 Plaka kodları: {plakalar}")

        detaylar['detaylar'] = uyari_icerik
        detaylar['baslama_zamani'] = baslama_zamani
        detaylar['bitis_zamani'] = bitis_zamani

        print(f"    ✅ Sonuç: Başlama={baslama_zamani}, Bitiş={bitis_zamani}")

        return detaylar

    except Exception as e:
        print(f"❌ Detay çekme hatası: {e}")
        return {'hata': f"İçerik çekilemedi: {str(e)}"}

def veritabanina_kaydet(uyari, detaylar):
    """Veriyi veritabanına kaydet - HER PLAKA İÇİN AYRI KAYIT"""
    if 'hata' in detaylar:
        print(f"❌ Hata: {detaylar['hata']}")
        return False

    try:
        # Valilik ID (plaka kodları) - HER PLAKA İÇİN AYRI KAYIT
        bulunan_plakalar = detaylar.get('detaylar', {}).get('Beklendiği Yer Plaka Kodları', [])
        # Bölge anahtar kelimesiyle birden fazla il eklenmişse, tekrarları kaldır ve sıralı tut
        bulunan_plakalar = list(dict.fromkeys([int(p) for p in bulunan_plakalar]))
        print(f"    🔍 Bulunan plakalar: {bulunan_plakalar}")

        # Eğer boşsa, uyarı başlığından illeri çıkarmaya çalış
        if not bulunan_plakalar:
            print("    🔍 Uyarı başlığından il bilgisi aranıyor...")
            baslik_metni = uyari['baslik']
            iller, yeni_plakalar = il_isimlerini_bul_ve_plakaya_cevir(baslik_metni)
            if iller:
                bulunan_plakalar.extend([int(p) for p in yeni_plakalar])
                # Tekrarları kaldır ve sıralı tut
                bulunan_plakalar = list(dict.fromkeys(bulunan_plakalar))
                print(f"    📍 Başlıktan bulunan iller: {iller}")
                print(f"    🔢 Başlıktan bulunan plakalar: {yeni_plakalar}")

        # Hala boşsa, detaylar içindeki diğer metinlerde ara
        if not bulunan_plakalar:
            print("    🔍 Detay metinlerinde il bilgisi aranıyor...")
            for key, value in detaylar.get('detaylar', {}).items():
                if key not in ['Beklendiği Yer İller', 'Beklendiği Yer Plaka Kodları']:
                    iller, yeni_plakalar = il_isimlerini_bul_ve_plakaya_cevir(str(value))
                    if yeni_plakalar:
                        bulunan_plakalar.extend([int(p) for p in yeni_plakalar])
                        # Tekrarları kaldır ve sıralı tut
                        bulunan_plakalar = list(dict.fromkeys(bulunan_plakalar))
                        print(f"    📍 {key} içinde bulunan iller: {iller}")
                        print(f"    🔢 Eklenen plakalar: {yeni_plakalar}")

        # Hala plaka bulunamazsa, <div id="divUyari"> içindeki tüm <p> etiketlerinde il ara
        if not bulunan_plakalar:
            print("    🔍 <div id='divUyari'> içindeki <p> etiketlerinde il aranıyor...")
            try:
                from bs4 import BeautifulSoup
                if 'soup_html' in detaylar:
                    soup = BeautifulSoup(detaylar['soup_html'], 'html.parser')
                elif 'soup' in detaylar:
                    soup = detaylar['soup']
                else:
                    response = requests.get(uyari['link'], timeout=10)
                    soup = BeautifulSoup(response.content, 'html.parser')
                div_uyari = soup.find('div', id='divUyari')
                if div_uyari:
                    p_list = div_uyari.find_all('p')
                    for p in p_list:
                        iller, yeni_plakalar = il_isimlerini_bul_ve_plakaya_cevir(p.get_text())
                        if yeni_plakalar:
                            bulunan_plakalar.extend([int(p) for p in yeni_plakalar])
                            # Tekrarları kaldır ve sıralı tut
                            bulunan_plakalar = list(dict.fromkeys(bulunan_plakalar))
                            print(f"    📍 <p> içinde bulunan iller: {iller}")
                            print(f"    🔢 Eklenen plakalar: {yeni_plakalar}")
                else:
                    print("    ⚠️  <div id='divUyari'> bulunamadı!")
            except Exception as e:
                print(f"    ❌ <div id='divUyari'> içindeki <p> arama hatası: {e}")

        # Eğer hala plaka bulunamadıysa, sadece 1 kayıt oluştur (valilik_id = 0)
        if not bulunan_plakalar:
            print("    ⚠️  Hiç plaka bulunamadı, genel kayıt oluşturuluyor...")
            bulunan_plakalar = [0]

        basarili_kayitlar = 0
        toplam_kayit = len(bulunan_plakalar)

        # HER PLAKA İÇİN AYRI KAYIT OLUŞTUR
        for i, plaka in enumerate(bulunan_plakalar, 1):
            print(f"    📝 [{i}/{toplam_kayit}] Plaka {plaka} için kayıt oluşturuluyor...")

            # Date - VARCHAR(10) formatında "DD.MM.YYYY"
            date = detaylar.get('tarih', datetime.now().strftime('%d.%m.%Y'))

            # Title - TEXT NOT NULL (her il için farklılaştır)
            il_adi = ""
            for il, plaka_no in plaka_kodlari.items():
                if plaka_no == plaka:
                    il_adi = il.capitalize()
                    break

            # Her il için title'ı farklılaştır (UNIQUE constraint için)
            if plaka == 0:
                title = uyari['baslik']
            else:
                title = f"{uyari['baslik']} ({il_adi})"

            # Keywords - JSONB
            keywords = [detaylar.get('uyari_turu', '')]
            if plaka != 0:
                keywords.append(f"il:{il_adi}")

            # Link - TEXT NOT NULL
            link = uyari['link']

            # Source URL - TEXT NOT NULL
            source_url = BASE_URL

            # Message - TEXT DEFAULT ''
            message_parts = []
            message_parts.append(f"Uyarı Türü: {detaylar.get('uyari_turu', '')}")
            message_parts.append(f"Tarih/Saat: {detaylar.get('tarih_saat', '')}")

            # Uyarı başlığı ekle (eğer varsa)
            if detaylar.get('uyari_baslik'):
                message_parts.append(f"Başlık: {detaylar.get('uyari_baslik')}")

            # İl bilgisi ekle
            if plaka != 0:
                message_parts.append(f"İl: {il_adi} (Plaka: {plaka})")

            message_parts.append("\nDetaylar:")

            # Detayları ekle
            for key, value in detaylar.get('detaylar', {}).items():
                if key not in ['Beklendiği Yer İller', 'Beklendiği Yer Plaka Kodları']:
                    message_parts.append(f"{key}: {value}")

            # Bulunan tüm il bilgilerini de mesaja ekle
            if len(bulunan_plakalar) > 1:
                tum_iller = []
                for p in bulunan_plakalar:
                    if p != 0:
                        for il_ad, plaka_no in plaka_kodlari.items():
                            if plaka_no == p:
                                tum_iller.append(il_ad.capitalize())
                                break
                if tum_iller:
                    message_parts.append(f"Tüm Etkilenen İller: {', '.join(tum_iller)}")

            message = "\n".join(message_parts)

            # Başlama ve bitiş zamanları
            baslama_zamani = detaylar.get('baslama_zamani')
            bitis_zamani = detaylar.get('bitis_zamani')

            # Eğer başlama ve bitiş zamanı belirlenememişse, created_at ve 2 gün sonrası olarak ayarla
            if not baslama_zamani or not bitis_zamani:
                created_at = datetime.now()
                if not baslama_zamani:
                    baslama_zamani = created_at
                if not bitis_zamani:
                    bitis_zamani = created_at + timedelta(days=2)
                print(f"    ⏳ Başlama/Bitiş zamanı belirlenemedi, varsayılan atandı: {baslama_zamani} - {bitis_zamani}")

            # Her il için valilik_id farklı, title farklı, UNIQUE constraint'e takılmaz
            basari = veritabanina_yaz(plaka, date, title, keywords, link, source_url, message, baslama_zamani, bitis_zamani)

            if basari:
                basarili_kayitlar += 1
                durum = "aktif" if not bitis_zamani or bitis_zamani > datetime.now() else "pasif"
                if plaka == 0:
                    print(f"      ✅ Genel kayıt eklendi - Tarih: {date}, Durum: {durum}")
                else:
                    print(f"      ✅ {il_adi} kaydı eklendi - Valilik ID: {plaka}, Durum: {durum}")
            else:
                print(f"      ❌ {il_adi} kaydı eklenemedi")

        print(f"    📊 Toplam {basarili_kayitlar}/{toplam_kayit} kayıt başarıyla eklendi")
        return basarili_kayitlar > 0

    except Exception as e:
        print(f"❌ Kayıt işlemi hatası: {e}")
        import traceback
        print(f"🔍 Hata detayı: {traceback.format_exc()}")
        return False

def pasif_duyurulari_sil():
    """Aktif olmayan (aktif=false) duyuruları sil"""
    conn = veritabani_baglantisi()
    if conn is None:
        return 0
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM announcements WHERE aktif = FALSE")
        silinen = cursor.rowcount
        conn.commit()
        cursor.close()
        conn.close()
        print(f"🗑️ {silinen} adet pasif duyuru silindi.")
        return silinen
    except Exception as e:
        print(f"❌ Pasif duyuruları silme hatası: {e}")
        return 0

# Ana işlem
def main():
    print("MGM UYARILARI VERİTABANINA KAYDEDİLİYOR...")
    print("=" * 60)


    # Pasif duyuruları sil
    pasif_duyurulari_sil()

    # Mevcut kayıt sayısını göster
    mevcut_kayit = mevcut_kayit_sayisi()
    print(f"📊 Mevcut kayıt sayısı: {mevcut_kayit}")

    # Tabloyu kontrol et ve gerekirse güncelle
    if not tabloyu_kontrol_et_ve_guncelle():
        print("❌ Tablo kontrolü başarısız!")
        return

    # ESKİ DUYURULARI TEMİZLE - DAHA GÖRÜNÜR
    print("\n🧹 ESKİ DUYURULAR TEMİZLENİYOR...")
    temizlenen_sayisi = eski_duyurulari_temizle()
    
    if temizlenen_sayisi > 0:
        print(f"🎯 Toplam {temizlenen_sayisi} adet süresi dolmuş duyuru pasif hale getirildi")
    else:
        print("🎯 Süresi dolmuş duyuru bulunamadı")

    # Linkleri çek
    print("\n🔗 MGM'DEN UYARILAR ÇEKİLİYOR...")
    uyarilar = mgm_selenium_ile_cek()

    if not uyarilar:
        print("❌ Hiç uyarı bulunamadı!")
        return

    print(f"\n✅ Toplam {len(uyarilar)} yeni uyarı bulundu.")

    # Tüm uyarıları işle ve veritabanına kaydet
    basarili_kayitlar = 0

    for i, uyari in enumerate(uyarilar, 1):
        print(f"\n[{i}/{len(uyarilar)}] İŞLENİYOR: {uyari['baslik']}")

        detaylar = uyari_detay_cek(uyari['link'])

        if veritabanina_kaydet(uyari, detaylar):
            basarili_kayitlar += 1

        time.sleep(2)

    # İŞLEM SONUNDA TEKRAR TEMİZLE
    print("\n🧹 İŞLEM SONUNDA TEKRAR TEMİZLİK YAPILIYOR...")
    son_temizlik = eski_duyurulari_temizle()

    # Son durumu göster
    yeni_kayit_sayisi = mevcut_kayit_sayisi()
    print(f"\n🎉 İşlem tamamlandı!")
    print(f"📈 Toplam {basarili_kayitlar}/{len(uyarilar)} yeni kayıt eklendi")
    print(f"🧹 Toplam {temizlenen_sayisi + son_temizlik} adet süresi dolmuş duyuru pasif hale getirildi")
    print(f"📊 Veritabanındaki toplam kayıt: {yeni_kayit_sayisi}")

# Çalıştır
if __name__ == "__main__":
    main()