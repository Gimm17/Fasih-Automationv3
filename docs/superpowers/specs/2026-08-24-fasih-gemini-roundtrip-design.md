# FASIH Automation v3 — Gemini Round-Trip (Auto-Poll → FASIH Loop → Round 2)

Tanggal: 2026-08-24
Status: Disetujui user (klarifikasi via Q&A)

## Konteks

Setelah fitur "Ekstrak UUID Assignment" mengirim Data Acuan + hasil query ke Gemini (round 1), extension berhenti. User ingin otomatisasi lanjutan: setelah Gemini merespons dengan `assignment_id_duplicate: <code>`, extension otomatis:

1. **Auto-poll** response Gemini, cari baris `assignment_id_duplicate:` → parse value (code usaha 16 digit, multiple dipisah `;`).
2. Tiap code → jalankan loop ekstraksi FASIH yang **sudah ada** (`doExtractCode` via `NEXT_CODE`).
3. Kumpulkan **link review lengkap** dari tombol Review (bukan UUID — Gemini ekstrak UUID dari slash terakhir sendiri).
4. **Round 2**: paste link ke Gemini, dipisah `;` (link; link; ...). Gemini finalisasi.

## Keputusan user (via Q&A)

- Tujuan akhir UUID hasil = **kirim balik ke Gemini** (round 2), bukan Excel.
- Cara baca response Gemini = **auto-poll** DOM chat Gemini.
- Value `assignment_id_duplicate:` = **code usaha** (16 digit) — extension yang search FASIH.
- Format round 2 = **link lengkap dipisah `;`** (`https://.../fd68.../11c8...; https://.../.../...`).

## Arsitektur

```
[round 1 sudah ada: kirim Data Acuan + hasil query → Gemini]
   ↓
background: setelah sendToGemini(round1), mulai POLL response Gemini
   - inject gemini-read.js (MAIN world) tiap N detik, baca chat terakhir
   - cari pola "assignment_id_duplicate:" → extract code (split ;)
   - ketemu & stabil (stream selesai) → kirim ASSIGN_DUP_CODES { codes } ke popup
   ↓
popup: terima ASSIGN_DUP_CODES
   - log "Gemini indikasi N duplikat"
   - jalankan loop NEXT_CODE yang SAMA dengan mode Ekstrak UUID
   - kumpulkan LINK (bukan uuid) dari tiap response doExtractCode
   ↓
popup: round 2
   - text = links.join(' ; ')
   - kirim EXTRACT_DONE { text } → background.sendToGemini (MAIN-world paste+send)
```

## Komponen yang diubah/dibuat

### `content.js` — `doExtractCode` return LINK
- Saat ini return `{ code, nama, uuid, status }`. Tambah `link` (URL review lengkap).
- `extractReviewLinkAddress` bisa return relative (`/app/assignment/...`) dari React props → join ke `https://fasih-sm.bps.go.id`.
- Return shape baru: `{ code, nama, uuid, link, status }`. `link` = absolute URL (kosong kalau gagal). `uuid` tetap dihitung (untuk log).
- Status `ok` = link dapat (uuid opsional). Kalau cuma uuid tanpa link → `skip` (link yang dibutuhkan round 2).

### `background.js` — router + poll response Gemini
- `EXTRACT_DONE` (round 1 & round 2) → `sendToGemini` (sudah ada, tidak diubah).
- **BARU**: setelah round-1 `sendToGemini` sukses, mulai polling. Implementasi: background inject `gemini-read.js` (MAIN world) berulang via `setTimeout`/alarm, baca response Gemini terakhir, cari `assignment_id_duplicate:`, parse code, dedup. Stabil (2 poll berturut-turut sama ATAU stream selesai marker) → `chrome.runtime.sendMessage({ type:'ASSIGN_DUP_CODES', codes })` ke popup.
- Guard: poll maks ~60 detik, lalu berhenti (kalau Gemini lambat/bukan indikasi duplikat).

### `gemini-read.js` (BARU) — baca response Gemini
- MAIN world. Query selector chat response terakhir (selector TBD — perlu contoh DOM response Gemini).
- Cari teks `assignment_id_duplicate:` → regex `assignment_id_duplicate:\s*([0-9]{16}(?:\s*;\s*[0-9]{16})*)` → split `;`.
- Return `{ found, codes, raw }`.

### `popup.js` — handler ASSIGN_DUP_CODES + round 2
- Listener `ASSIGN_DUP_CODES { codes }`: log, validasi (skip kalau kosong), jalankan loop `NEXT_CODE` (reuse handler Ekstrak UUID) → akumulasi `links` (dari `res.link`).
- Round 2: `text = links.filter(Boolean).join(' ; ')` → `chrome.runtime.sendMessage({ type:'EXTRACT_DONE', text })`.
- UX: status jelas — "Menunggu Gemini round 1..." → "Gemini indikasi N duplikat, ekstrak link..." → "Round 2 terkirim".

## Reuse

- `doExtractCode` / `NEXT_CODE` loop — content.js (sudah ada), hanya tambah return `link`.
- `sendToGemini` / `FASIH_FILL_GEMINI` — background.js (sudah ada, tidak diubah).
- `extractReviewLinkAddress` — content.js (sudah ada), tinggal absolute-kan relative URL.
- Loop handler Ekstrak UUID di popup.js — reuse untuk round-trip (extract link).

## Yang perlu user berikan (manual)

1. **Contoh jawaban Gemini** berisi `assignment_id_duplicate:` — untuk kunci regex + selector response DOM. Tanpa ini, parser tebak.
2. (Opsional) Inspect response Gemini → struktur container chat (class/role) untuk `gemini-read.js`.

## Risiko

- Selector response Gemini DOM belum diverifikasi → poll bisa tidak menemukan. Mitigasi: `gemini-read.js` dump kandidat container ke console kalau pola tidak ketemu, user lapor.
- Stream Gemini belum selesai saat poll → ambil parsial. Mitigasi: stabil-check (2 poll sama) + marker "selesai".
- Relative URL dari React props → join host manual.
- Kalau Gemini tidak indikasi duplikat (tidak ada `assignment_id_duplicate:`), poll timeout 60s → log "tidak ada indikasi duplikat", selesai.

## Testing

1. `node --check` semua JS.
2. Reload extension, 2 tab (FASIH + Gemini).
3. Round 1: kirim query → Gemini generate → lihat popup log "Gemini indikasi N duplikat".
4. Loop ekstraksi jalan otomatis → tiap code → link terkumpul.
5. Round 2: link dipaste ke Gemini dipisah `;`, terkirim. Badge `✓`.
6. Edge: Gemini tidak indikasi duplikat → poll timeout, log, selesai (tidak crash).
