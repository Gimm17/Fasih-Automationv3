# FASIH Automation v3 — Ekstraksi UUID Assignment (Tahap Lanjutan)

Tanggal: 2026-08-24
Status: Disetujui user (pendekatan A: popup orchestrate, content.js ekstrak)

## Konteks

Extension v3 "Quick Copy" sudah bisa: scrape hasil query FASIH → bungkus Data Acuan + hasil → auto-send ke Gemini. Setelah Gemini menganalisis dan menyebut code usaha mana yang **terindikasi duplikat**, user perlu tahap lanjutan: untuk setiap code terindikasi duplikat, cari di FASIH → buka detail → ekstrak link assignment → ambil UUID → kirim kumpulan UUID ke Gemini supaya generate `assignment_id_duplicate`.

Alur manual saat ini: copy code usaha → paste FASIH search → buka detail → copy link address → paste Gemini. Tahap ini mengotomasi seluruhnya.

## Keputusan user

- Sumber code usaha = **dari jawaban Gemini** (hanya yang terindikasi duplikat, sisanya skip).
- Output UUID = **kirim ulang ke Gemini** (bukan clipboard/Excel).
- Tahap buka detail = **auto penuh**: search → klik kartu → modal → tombol Review → ekstrak link → UUID → tutup modal.
- Pendekatan A: popup orchestrate queue, content.js FASIH ekstrak satu per satu.

## Arsitektur

```
[popup: paste daftar code terindikasi duplikat]
   ↓ Mulai Ekstrak
popup → NEXT_CODE { code, searchDelay, modalDelay } ke content.js  (satu per satu)
content.js:
  search(code) → getFreshSearchInput → setInputValue
  poll kartu → klik kartu → tunggu modal (findReviewButton)
  → extractReviewLinkAddress → extractAssignmentIdFromReviewUrl → UUID
  → closeDetailModal → balas { code, nama, uuid, status } ke popup
popup kumpulkan + log progress tiap code
   ↓ semua selesai / stop
popup → background.sendToGemini(text gabungan)  [reuse v3]
   → tab Gemini, paste+send (reuse MAIN-world FASIH_FILL_GEMINI)
```

## Reuse

- `setInputValue`, `getFreshSearchInput`, `delay`, `collectCards` — sudah di v3 `content.js`.
- `findReviewButton`, `extractReviewLinkAddress`, `closeDetailModal`, `extractAssignmentIdFromReviewUrl`, `capturedWindowOpenUrl` intercept — dari `FASIH-AUTOMATION/extension/content.js` (dipindah ke v3 content.js).
- `sendToGemini` + `FASIH_FILL_GEMINI` (MAIN-world) — v3 `background.js`, tidak diubah.

## Komponen yang diubah/dibuat

### `content.js` (FASIH, v3) — tambah mode ekstrak
- Pindahkan dari project lama: `isUUID`, `extractAssignmentIdFromReviewUrl`, `findReviewButton`, `waitForReviewButton`, `closeDetailModal`, `extractReviewLinkAddress`, interceptor `window.open` (capturedWindowOpenUrl + message listener + inject interceptor script).
- Listener pesan baru:
  - `NEXT_CODE { code, searchDelay, modalDelay }` → `doExtractCode(code, delays)` → `sendResponse({ code, nama, uuid, status })`.
  - `STOP_EXTRACT` → set flag `state.shouldStopExtract`.
- `doExtractCode`:
  1. `getFreshSearchInput` → `setInputValue(input, '')` → `setInputValue(input, code)` → `delay(searchDelay)`.
  2. Poll kartu hasil (reuse `collectCards` / query tombol assignment-list-item) → cari kartu yang `code` cocok (normalizeCode match). Tidak ada → return `notfound`.
  3. `clickElement(kartu)` → `waitForReviewButton(modalDelay)` → `extractReviewLinkAddress` → UUID. Fallback: klik Review + baca `capturedWindowOpenUrl`. Tidak dapat → `skip`.
  4. `closeDetailModal()` → return `ok { uuid, nama }`.
- Flag stop diperiksa antar code (bukan di tengah klik).

### `background.js` (v3) — tambah router EXTRACT
- `EXTRACT_DONE { text }` dari popup → `sendToGemini(text)` (reuse).
- `sendToGemini`/`FASIH_FILL_GEMINI` tidak diubah.

### `popup.html/css/js` — tambah section "Ekstrak UUID Assignment"
- `<textarea id="extractCodes">` daftar code (satu per baris).
- Tombol **▶ Ekstrak UUID** + **⏹ Stop** (rebind mode, reuse progress/log).
- `<input id="cfgModal" value="2000">` delay modal (tambah) + `cfgSearch` reuse.
- Form Data Acuan tetap (ikut dikirim ke Gemini).
- Handler: parse daftar → loop kirim `NEXT_CODE` satu per satu ke content.js (tab FASIH) → akumulasi → `EXTRACT_DONE` → background. Stop → `STOP_EXTRACT`.

## Data per code

```js
{ code, nama, uuid, status }
// status: "ok" | "notfound" | "skip"
```

## Format output ke Gemini

```
"DATA ACUAN"
<form Data Acuan>

"UUID ASSIGNMENT (hasil ekstrak):"
{code} - {nama} - {uuid}           // status ok
{code} - {nama} - [GAGAL EKSTRAK]  // status skip
{code} - [TIDAK DITEMUKAN]         // status notfound
```
Hanya code berstatus `ok` punya UUID asli; `skip`/`notfound` ditandai supaya Gemini tahu mana yang gagal.

## Error handling & timing

- Search tidak ketemu kartu → `notfound`, lanjut code berikutnya (tidak stop batch).
- Tombol Review tidak muncul (modal tidak kebuka) → timeout `modalDelay` (default 8s guard) → `skip`, lanjut.
- Link tidak ter-ekstrak → fallback klik Review + intercept `window.open` → masih gagal → `skip`.
- Modal tidak nutup → fallback `Escape` keydown (dari lama).
- Stop: popup set `STOP_EXTRACT` → content.js berhenti di antar code.
- Delays configurable: `cfgSearch` (1500), `cfgModal` (2000).

## Testing

1. `node --check` semua JS.
2. Reload extension, 2 tab (FASIH + Gemini).
3. Paste 2-3 code yang ada di FASIH → Ekstrak UUID → log tiap code → UUID. Cek manual: klik kartu di FASIH, copy link address, bandingkan UUID = sama.
4. Campur 1 code tidak ada → `notfound`, lanjut.
5. Selesai → tab Gemini, "DATA ACUAN + UUID ASSIGNMENT" masuk + terkirim.

## Risiko

Selector tombol Review + struktur link assignment di FASIH sekarang belum diverifikasi (logika dari project 2025). Kalau FASIH berubah, code ber-status `skip` memberi sinyal → user kirim screenshot modal detail → kunci selector ulang. Tidak menyebabkan data rusak (hanya skip).
