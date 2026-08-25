# CLAUDE.md — FASIH Automation v3

Chrome extension (MV3) untuk otomasi scraping data **FASIH-SM BPS** (`fasih-sm.bps.go.id`) dan analisis duplikasi data SBR/SE26 via **Google Gemini**.

## Tujuan

User (surveyor BPS) dulu mengetik manual tiap langkah: search kode bangunan di FASIH → catat hasil → tanya Gemini → tulis ke Excel. Extension ini mengotomasi seluruh rantai itu menjadi satu klik.

## Main case (alur penuh satu entitas)

1. **Input** — file Excel berisi 6 kolom: `data1`, `code_identity`, `Batch_Multi-Keyword_(variasin_nama)`, `assignment_id_duplicate`, `nama_duplicate`, `catatan`.
2. **Per baris**, extension:
   - Data Acuan = `"{data1} {code_identity}"`
   - Keyword = `Batch_Multi-Keyword_(variasin_nama)` dipisah `;`
   - Cari tiap keyword di field search FASIH (`input[placeholder="Cari..."]`), scrape semua hasil query (list card FASIH).
   - Kirim `"DATA ACUAN"` + `"HASIL QUERY:"` → Gemini (**round-1**).
   - Poll respons Gemini → ambil `nama_duplicate:` + `catatan 2:` + kode terindikasi duplikat (di `assignment_id_duplicate:`).
   - Untuk tiap kode terindikasi → search FASIH → klik kartu → modal detail → tombol Review → ambil **link review**.
   - Kirim link (dipisah ` ; `) → Gemini (**round-2**) → poll `assignment_id_duplicate:` final (UUID).
   - Tulis 3 kolom hasil: `assignment_id_duplicate` (UUID), `nama_duplicate`, `catatan`.
3. **Output** — download file baru `{nama}_hasil.xlsx` (file asli tidak diubah).

## Aturan penting (jangan dilanggar)

- **FASIH butuh VPN pegawai** — tidak bisa diakses tanpa itu. Extension tidak bisa di-test terhadap FASIH tanpa VPN user.
- **Orchestration harus di background service worker**, bukan popup — popup otomatis tertutup saat `chrome.tabs.update({active:true})` pindah ke tab Gemini.
- **SW MV3 idle ~30 detik bisa dimatikan** — pakai keep-alive `chrome.alarms` (`periodInMinutes >= 0.5`) selama loop panjang. Jangan biarkan gap async > 30s tanpa heartbeat/alarm.
- **`gemini-read.js` mode-aware**: round-1 respons punya `nama_duplicate:`/`catatan:`; round-2 hanya `assignment_id_duplicate:` (UUID). Nilai label diambil UTUH, jangan paksa pola 16-digit (bisa `7271011001000200 - UMK - 76`, `7271 - SE26ms2khy63AA`, atau UUID).
- **Di-inject ke Gemini harus `world:'MAIN'`** — isolated world tidak bisa fokus/munculkan tombol send Quill.
- **Kode di Gemini ditulis markdown bold** (`**label:**`) — strip `**` sebelum regex.
- **Response Gemini terbaru** — pilih elemen TERKECIL yang match pola (bukan wrapper conversation yang berisi turn lama).

## Workflow / alur pesan

```
popup.js  --START_EXCEL_RUN {rows}-->  background.js (startExcelRun, loop per baris)
   |                                          |
   |  --START_BATCH {noAutoSend}-->  content.js (doBatch = search+scrape FASIH)
   |  <--BATCH_DONE {text}--  (pendingBatchText)
   |  --sendToGemini--> Gemini (MAIN world fill+send)
   |  --pollGeminiUntil/ readGeminiResponse-->  gemini-read.js (parse respons)
   |  --NEXT_CODE {code}-->  content.js (doExtractCode = cari kartu → Review → link)
   |  --runBgFasihExtract (kumpulan link)--> sendToGemini round-2
   |  --EXCEL_RUN_DONE {results}-->  popup.js (download xlsx)
```

## File & tanggung jawab

| File | Peran |
|---|---|
| `extension/background.js` | service worker: router pesan, `sendToGemini` (+`FASIH_FILL_GEMINI` MAIN world paste+send), `pollGeminiResponse`/`pollGeminiUntil`, `runBgFasihExtract`, `startExcelRun` (orchestrator Excel) |
| `extension/content.js` | content script FASIH: `doBatch` (search+scrape), `doExtractCode`/`findCardForCode` (buka detail → link), `collectCards`/`autoScrollAll`, `setInputValue`/`getFreshSearchInput` |
| `extension/gemini-read.js` | MAIN world: baca respons Gemini terbaru, parse mode round-1/round-2, `valueToQueries` |
| `extension/gemini-send.js` | legacy (diganti fungsi MAIN-world di background) |
| `extension/popup.html/js/css` | UI upload Excel / batch / extract; download hasil via `libs/xlsx.full.min.js` |
| `extension/libs/xlsx.full.min.js` | SheetJS parse+write Excel |
| `extension/interceptor.js` | intercept `window.open` page-context (fallback ambil link Review) |

## Target DOM (bisa berubah; cek ulang kalau scraping kosong)

- Search FASIH: `input[placeholder="Cari..."]`
- Hasil query: `button[data-tsd-source*="assignment-list-item"]` (judul `KODE - SKALA - NO_URUT`) — TAPI WAS: halaman punya **2 mode tampilan** (list vs tabel). Kalau `collectCards` return 0 padahal hasil tampak, cek mode tampilan dulu (jangan ubah selector tanpa verifikasi).
- Modal detail / tombol Review: `button[data-tsd-source*="assignment-action"]` atau teks "Review"; link assignment `/app/assignment/{periodId}/{assignmentId}`.
- Gemini input: `div.ql-editor[contenteditable="true"]` (pilih yang terlihat + rect terbesar, bukan sidebar). Tombol send: `mat-icon[data-mat-icon-name="arrow_upward"]`.

## Format output ke Gemini (untuk Gemini paham konteksnya)

```
"DATA ACUAN"
{data1} {code_identity}

"HASIL QUERY:"
{blok per hasil: baris ringkas "KODE - NAMA - IDSBR - SLS" lalu semua field detail}
```

User sudah melatih Gemini dengan aturan verifikasi duplikasi SBR/SE26 (spasial, entitas usaha, perlakuan NIB/email/IDSBR, format `assignment_id_duplicate`/`nama_duplicate`/`catatan 2`). Jangan ubah format header ini.

## Cara test

Selalu: `node --check` semua JS + validasi `manifest.json`. Tes live butuh VPN FASIH + 2 tab (FASIH + Gemini) + reload extension di `chrome://extensions`. Kalau error runtime, buka service worker console (`chrome://extensions` → kartu → "service worker") — log SW ada di sana, bukan di popup (popup tertutup saat pindah tab).
