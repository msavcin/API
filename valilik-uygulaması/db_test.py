import psycopg2

DB_CONFIG = {
    'host': 'localhost',
    'database': 'kampdefterim',
    'user': 'postgres',
    'password': '"s1vc10n',
    'port': '5432'
}

try:
    conn = psycopg2.connect(**DB_CONFIG)
    print("✅ PostgreSQL bağlantısı başarılı!")
    conn.close()
except Exception as e:
    print(f"❌ Bağlantı hatası: {e}")