// dbtest.js
const { Client } = require("pg");

// PostgreSQL bağlantı bilgileri
const client = new Client({
  host: "localhost",     // Lightsail üzerinde DB başka instance ise IP gir
  port: 5432,            // PostgreSQL varsayılan port
  user: "postgres",      // kendi kullanıcı adın
  password: "s1vc10n",     // kendi şifren
  database: "kampdefterim",    // kendi veritabanın
});

async function connectDB() {
  try {
    await client.connect();
    console.log("Bağlantı başarılı 🚀");
  } catch (err) {
    console.error("Bağlantı hatası ❌", err);
  } finally {
    await client.end();
  }
}

connectDB();
