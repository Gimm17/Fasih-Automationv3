# FASIH Quick Copy — Design

Tanggal: 2026-08-24
Status: Disetujui user (pendekatan A: klik langsung tanpa popup)

## Tujuan
Extension Chrome yang men-scrape SEMUA hasil query dari halaman pencarian FASIH-SM BPS (`fasih-sm.bps.go.id`) dan langsung meng-copy-nya ke clipboard dalam format teks tetap, dengan satu klik ikon extension. User tinggal paste ke file mereka.

## Arsitektur
MV3, 3 file di `extension/`:

| File | Peran |
|---|---|
| `manifest.json` | MV3; permissions `activeTab`, `scripting`, `clipboardWrite`; host `https://fasih-sm.bps.go.id/*`; tanpa content script permanen, tanpa popup |
| `background.js` | Service worker: `chrome.action.onClicked` → inject `scraper.js` via `chrome.scripting.executeScript` → terima hasil |
| `scraper.js` | Di-inject on-demand: auto-scroll → kumpulkan card hasil → parse field → susun teks → copy clipboard |

Feedback hanya via badge ikon:
- Hijau + angka = sukses, angka = jumlah hasil ter-copy
- Merah `✖` = gagal (bukan halaman FASIH / tidak ada hasil / clipboard error)

## Alur Scraping (adaptasi dari content.js project FASIH-AUTOMATION)
1. Validasi halaman: URL host `fasih-sm.bps.go.id` dan ada minimal satu card hasil ATAU search input.
2. Auto-scroll: deteksi container list (`overflow-y: auto/scroll`, `scrollHeight > clientHeight`, berisi card); scroll bertahap sampai `scrollTop` berhenti bertambah (virtualized list termuat semua). Guard maksimal ~30 detik dan maksimal 200 iterasi scroll.
3. Kumpulkan card: deteksi via `[data-tsd-source*="assignment-list-item"]` + fallback struktur LI/TR/card seperti `getResultItems()` lama. Dedup per kode identity (kode di-normalisasi: strip prefix region `^\d{4,}\s*[-–—]\s*`).
4. Parse field per card dari label FASIH:
   - Nama Keluarga/Bangunan/Usaha
   - Alamat Prelist
   - Nomor Urut Bangunan / IDSBR
   - NIB / No. KK
   - Email
   - Skala Usaha / Jenis Prelist
   - Jumlah Usaha
   - Kode Pos
   - Perubahan SLS
5. Susun teks → `navigator.clipboard.writeText()`; fallback textarea + `document.execCommand('copy')`.

## Format Clipboard
Per hasil:

```
{KODE} - {NAMA} - {IDSBR} - {STATUS SLS}
---
Nama Keluarga/Bangunan/Usaha
RUMAH KOSONG
Alamat Prelist
-
Nomor Urut Bangunan / IDSBR
37 /
NIB / No. KK
-
Email
-
Skala Usaha / Jenis Prelist
-
Jumlah Usaha
0
Kode Pos
-
Perubahan SLS
2. Tidak
```

Baris ringkas: `kode - nama - nomor urut/idsbr - perubahan SLS`. Antar hasil dipisah baris kosong.

## Error Handling
Semua kegagalan → badge `✖` merah + `console.error` di tab untuk debugging:
- Halaman bukan FASIH
- Tidak ada card hasil ditemukan
- Semua metode clipboard gagal

## Testing
Load unpacked di Chrome → buka halaman query FASIH dengan hasil → klik ikon extension → paste ke notepad → verifikasi jumlah hasil dan isi sama dengan tampilan layar (termasuk hasil yang tadinya belum ter-scroll).
