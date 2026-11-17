# Uptime Kuma SRE Middleware (Temporal + Google Chat)

Middleware penerima webhook dari **Uptime Kuma** yang secara otomatis menangkap tampilan visual (*screenshot*) halaman target menggunakan **Puppeteer (Chromium)**, mengunggahnya ke **ImgBB**, dan mengirimkan kartu peringatan insiden (`cardsV2`) ke **Google Chat** dengan mekanisme antrean dan *auto-retry* berbasis **Temporal**.

---

## Arsitektur & Alur Kerja

Sistem dipecah menjadi beberapa komponen terpisah agar proses *capture* browser tidak membebani server saat terjadi insiden massal (*alert storm*) dan dapat melanjutkan eksekusi dari titik gagal (*checkpoint*).

```CLI
Uptime Kuma (Webhook POST)
       │
       ▼
middle-server.js (Express Receiver - Port 3000)
       │  ├─ Balas HTTP 200 OK instan ke Uptime Kuma
       │  └─ Daftarkan tugas ke Temporal Task Queue
       ▼
temporal-server (Engine & SQLite State - Port 7233 / UI 8233)
       │
       ▼
worker.js (Temporal Worker - Maks. 2 Chromium paralel)
       │
       ▼
workflows.js (Orkestrasi & Kebijakan Retry)
       ├──► Step 1: activities.js -> captureAndUpload() (Puppeteer + ImgBB)
       └──► Step 2: activities.js -> dispatchGoogleChat() (Google Chat cardsV2)
```

## Struktur Direktori

```CLI
~/javascript/middleware-chat-webhook/
├── config.json             # Konfigurasi port, webhook Google Chat, API key ImgBB, & mention
├── middle-server.js        # HTTP server penerima webhook (Temporal Client / Producer)
├── workflows.js            # Definisi alur kerja deterministik & penyusunan payload cardsV2
├── activities.js           # Eksekusi I/O: headless Chromium, upload ImgBB, & POST Google Chat
├── worker.js               # Worker pemroses antrean dengan batas concurrency
├── ecosystem.config.cjs    # Konfigurasi proses manajemen PM2
├── temporal-state.db       # Database SQLite penyimpanan state antrean Temporal
└── package.json            # Dependensi Node.js (ES Module)
```


## Prasyarat Sistem
- Node.js v18+ (dengan "type": "module" di package.json)

- Chromium Browser terpasang di /usr/bin/chromium-browser

- PM2 (npm install -g pm2)

- Temporal CLI terpasang di /usr/local/bin/temporal

# Konfigurasi (config.json)
Pastikan file config.json tersedia di root direktori proyek dengan format berikut:

```JSON
{
  "PORT": 3000,
  "GOOGLE_CHAT_WEBHOOK_URL": "[https://chat.googleapis.com/v1/spaces/XXXX/messages?key=YYYY&token=ZZZZ](https://chat.googleapis.com/v1/spaces/XXXX/messages?key=YYYY&token=ZZZZ)",
  "IMGBB_API_KEY": "your_imgbb_api_key",
  "ENGINEER_MENTION": "<users/all>"
}
```

# Instalasi & Menjalankan Layanan
  1. Install Dependensi Node.js:

```Bash
npm install
```

  2. Jalankan Seluruh Layanan via PM2:

```Bash
pm2 start ecosystem.config.cjs
pm2 save
```

Perintah ini menjalankan 3 proses sekaligus:

- temporal-server: Server Temporal lokal dengan penyimpanan persisten SQLite (./temporal-state.db).

- sre-worker: Worker Node.js yang mendengarkan queue uptime-kuma-sre-queue (dibatasi maksimal 2 proses Chromium bersamaan).

- sre-webhook-receiver: Endpoint Express pada port 3000.

## Operasional & Monitoring
## Cek Status Proses PM2
```Bash
pm2 status
pm2 logs sre-worker sre-webhook-receiver --lines 30
```

## Verifikasi Antrean & Worker Temporal
``` Bash
# Cek daftar workflow yang berjalan atau selesai
temporal workflow list

# Pastikan worker aktif polling pada task queue
temporal task-queue describe --task-queue uptime-kuma-sre-queue
``` 

## Akses Web UI Temporal (via SSH Tunnel)
Untuk memantau riwayat alert, durasi eksekusi, dan detail retry secara visual dari komputer lokal:

```Bash
ssh -L 8233:127.0.0.1:8233 alaneee@<IP-SERVER>
```
Buka http://localhost:8233 pada browser.

# Uji Coba Webhook
Kirim simulasi payload Uptime Kuma ke endpoint lokal:

```Bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "msg": "Testing Temporal Queue",
    "monitor": {
      "id": 99,
      "name": "Production Domain Check",
      "url": "[https://example.com](https://example.com)"
    }
  }'
```

# Mekanisme Ketahanan (Fault Tolerance)
- Concurrency Control: maxConcurrentActivityTaskExecutions: 2 pada worker.js mencegah lonjakan penggunaan RAM/CPU akibat peluncuran puluhan instance Chromium secara bersamaan.

- Step-Level Retry: Jika pengiriman ke Google Chat gagal karena gangguan jaringan sementara, Temporal otomatis mengulang hanya fungsi dispatchGoogleChat tanpa mengulang proses screenshot Chromium maupun upload ImgBB.

- Auto-Cleanup: File tangkapan layar sementara di /tmp/ dihapus otomatis pada blok finally setelah proses unggah selesai.
