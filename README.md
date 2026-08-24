# FASIH Automation v3 — Quick Copy

Chrome extension (MV3) untuk otomasi pengambilan hasil query dari **FASIH-SM BPS** (`fasih-sm.bps.go.id`) dan mengirimnya otomatis ke **Google Gemini** untuk analisis duplikasi data SBR/SE26.

## Fitur

- **Copy Sekarang** — scrape semua hasil query yang sedang tampil di halaman FASIH, bungkus dengan header "DATA ACUAN" + "HASIL QUERY:", lalu copy ke clipboard (juga otomatis dikirim ke Gemini).
- **Batch Multi-Keyword** — isi daftar keyword (satu per baris), extension mengetiknya satu per satu ke field search FASIH, scrape semua hasil tiap keyword, gabungkan, lalu kirim ke Gemini.
- **Form Data Acuan** — teks header tetap (data bangunan/usaha yang diverifikasi) yang disertakan di atas hasil saat dikirim ke Gemini. Tidak berubah dari input sampai terkirim.
- **Auto-send Gemini** — setelah selesai scrape, extension pindah ke tab Gemini, paste teks ke kotak prompt, lalu klik tombol send (mode MAIN-world, selector Quill `div.ql-editor`).
- **Backup clipboard** — teks juga disalin ke clipboard bawaan untuk paste manual bila auto-send gagal.

## Struktur

```
extension/
  manifest.json     MV3, permissions activeTab/scripting/clipboardWrite/tabs/storage
  background.js     service worker: router pesan + auto-send ke Gemini (MAIN world)
  content.js        content script FASIH: scrape + search batch + copy
  gemini-send.js    (legacy probe, kini diganti MAIN-world func di background.js)
  popup.html/css/js UI: Data Acuan + Copy Sekarang + batch + progress/log
  icons/            ikon extension
docs/superpowers/specs/  dokumen desain
```

## Cara pakai

1. Load unpacked di `chrome://extensions` → pilih folder `extension/`.
2. Buka dua tab: **FASIH** (halaman hasil query/siap cari) + **Gemini** (`gemini.google.com/app`).
3. Klik ikon extension → isi **Data Acuan** (opsional) + keyword (untuk batch).
4. Klik **Copy Sekarang** atau **Mulai Batch**.
5. Setelah selesai, extension otomatis pindah ke tab Gemini, mengisi prompt, dan mengirim.

## Catatan

Ditujukan untuk verifikasi duplikasi data FASIH SBR/SE26 BPS. Selector DOM FASIH/Gemini dapat berubah seiring pembaruan UI — sesuaikan di `content.js` / `background.js` bila perlu.
