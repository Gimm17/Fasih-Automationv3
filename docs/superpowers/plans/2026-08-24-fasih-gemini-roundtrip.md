# FASIH Gemini Round-Trip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Setelah round-1 (kirim query ke Gemini), extension auto-poll response Gemini untuk `assignment_id_duplicate: <code>`, lalu tiap code di-search di FASIH → ekstrak link review lengkap → paste link (dipisah `;`) ke Gemini round-2.

**Architecture:** background.js inject `gemini-read.js` (MAIN world) berulang untuk baca response Gemini, parse `assignment_id_duplicate:` regex, kirim `ASSIGN_DUP_CODES` ke popup. Popup jalankan loop `NEXT_CODE` (reuse, `doExtractCode` kini return `link`). Link dikumpulkan → `EXTRACT_DONE` → `sendToGemini` round-2.

**Tech Stack:** Chrome Extension MV3, `chrome.scripting` MAIN-world, vanilla JS.

**Parser kunci (dari user):** format `assignment_id_duplicate: 7271030002000300; 7271020008003401` — satu baris, `:` + spasi, `;` pemisah (boleh spasi sekitar `;`). Value = code usaha 16 digit.

---

## File Structure

| File | Tanggung jawab |
|---|---|
| `extension/content.js` | **ubah** `doExtractCode`: return `link` (URL review absolute) selain `uuid`; absolute-kan relative URL dari React props. |
| `extension/gemini-read.js` | **buat** — MAIN world, baca response Gemini terakhir, regex `assignment_id_duplicate:`, return `{ found, codes, raw }`. |
| `extension/background.js` | **ubah** — setelah round-1 sendToGemini sukses, poll `gemini-read.js` berulang; ketemu → `ASSIGN_DUP_CODES` ke popup; `EXTRACT_DONE` (round 1 & 2) tetap → sendToGemini. |
| `extension/popup.js` | **ubah** — listener `ASSIGN_DUP_CODES`: jalankan loop `NEXT_CODE` → kumpulkan `link` → `EXTRACT_DONE` round-2. UX status jelas. |

`gemini-send.js` legacy tetap (tidak dipakai langsung, `FASIH_FILL_GEMINI` di background yang aktif).

---

## Task 1: doExtractCode return link (absolute)

**Files:** Modify `extension/content.js`

- [ ] **Step 1: Ubah `doExtractCode` untuk simpan & return link absolute**

Di `doExtractCode`, setelah `extractReviewLinkAddress` menghasilkan `reviewUrl`, absolute-kan:

```javascript
  let reviewUrl = reviewBtn ? extractReviewLinkAddress(reviewBtn, document.body) : '';
  if (!reviewUrl) reviewUrl = extractReviewLinkAddress(btnEl, btnEl);

  // Absolute-kan URL relative dari React props (mis. "/app/assignment/.../...").
  if (reviewUrl && reviewUrl.startsWith('/')) {
    reviewUrl = 'https://fasih-sm.bps.go.id' + reviewUrl;
  }

  let uuid = reviewUrl ? extractAssignmentIdFromReviewUrl(reviewUrl) : '';
```

Lalu fallback window.open juga absolute-kan:

```javascript
  // 5. Fallback: klik Review + tangkap window.open.
  if (!isUUID(uuid) && reviewBtn) {
    capturedWindowOpenUrl = '';
    clickElement(reviewBtn);
    await delay(1200);
    const openUrl = capturedWindowOpenUrl;
    if (openUrl) {
      const abs = openUrl.startsWith('/') ? 'https://fasih-sm.bps.go.id' + openUrl : openUrl;
      uuid = extractAssignmentIdFromReviewUrl(abs);
      if (!reviewUrl) reviewUrl = abs;
    }
  }
```

Ubah return shape — tambah `link`, dan status `ok` = link dapat:

```javascript
  const nama = card.nama || '';
  if (reviewUrl) return { code, nama, uuid, link: reviewUrl, status: 'ok' };
  if (isUUID(uuid)) return { code, nama, uuid, link: '', status: 'ok' };
  return { code, nama, status: 'skip', reason: 'UUID/link tidak ter-ekstrak' };
```

(Tetap return `uuid` untuk log; `link` yang dipakai round-2.)

- [ ] **Step 2: Syntax check**

Run: `node --check extension/content.js` — expect exit 0.

- [ ] **Step 3: Commit**

```bash
git add extension/content.js
git commit -m "feat: doExtractCode return link review absolute (round-2 siap)"
```

---

## Task 2: gemini-read.js (MAIN world, baca response Gemini)

**Files:** Create `extension/gemini-read.js`

- [ ] **Step 1: Buat file**

```javascript
/**
 * FASIH Quick Copy — gemini-read.js
 * Di-inject (MAIN world) oleh background untuk membaca response Gemini terakhir.
 * Cari pola "assignment_id_duplicate: <code>; <code>" -> return { found, codes, raw }.
 *
 * Format (user): assignment_id_duplicate: 7271030002000300; 7271020008003401
 */
'use strict';

(function () {
  // Kumpulkan semua teks response Gemini: response container umum.
  // Selector luas dulu, fallback ke document body text.
  const candidates = [];
  const sels = [
    'model-response',
    '[class*="message-content"]',
    '[class*="model-response"]',
    '[class*="response-container"]',
    '[data-message-id]',
    '[class*="conversation"]',
  ];
  for (const s of sels) {
    try {
      const els = document.querySelectorAll(s);
      els.forEach((e) => candidates.push(e));
    } catch (_) {}
  }

  // Ambil teks gabungan dari kandidat terakhir (response paling baru), fallback body.
  let text = '';
  if (candidates.length) {
    // Ambil elemen terakhir (asumsi: chat terbaru di bawah).
    text = (candidates[candidates.length - 1].innerText || '').replace(/\s+/g, ' ');
  } else {
    text = (document.body.innerText || '').replace(/\s+/g, ' ');
  }

  // Regex: assignment_id_duplicate: <16 digit>(; <16 digit>)*  (toleransi spasi/newline sekitar ;)
  const re = /assignment_id_duplicate\s*:\s*([0-9]{16}(?:\s*[;,]\s*[0-9]{16})*)/i;
  const m = text.match(re);

  let codes = [];
  if (m && m[1]) {
    codes = m[1].split(/[;,]/).map((s) => s.trim()).filter((s) => /^\d{16}$/.test(s));
  }

  // Dedup, urutan pertama muncul.
  const seen = new Set();
  codes = codes.filter((c) => (seen.has(c) ? false : (seen.add(c), true)));

  return { found: codes.length > 0, codes, raw: m ? m[0] : '' };
})();
```

- [ ] **Step 2: Syntax check**

Run: `node --check extension/gemini-read.js` — expect exit 0.

- [ ] **Step 3: Commit**

```bash
git add extension/gemini-read.js
git commit -m "feat: gemini-read.js baca response Gemini + parse assignment_id_duplicate"
```

---

## Task 3: background.js poll response Gemini + ASSIGN_DUP_CODES

**Files:** Modify `extension/background.js`

- [ ] **Step 1: Tambah fungsi `readGeminiResponse(tabId)`**

```javascript
async function readGeminiResponse(tabId) {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      files: ['gemini-read.js'],
    });
    return res && res.result;
  } catch (err) {
    logPopup(`⚠️ Gagal baca Gemini: ${err.message}`, 'warning');
    return null;
  }
}
```

- [ ] **Step 2: Tambah fungsi `pollGeminiResponse(tabId)`**

```javascript
// Poll response Gemini tiap 3 detik, maks ~90 detik. Stabil-check: 2 poll berturut-turut
// sama (stream selesai). Ketemu codes -> ASSIGN_DUP_CODES ke popup.
async function pollGeminiResponse(tabId) {
  const POLL_MS = 3000;
  const DEADLINE = Date.now() + 90000;
  let lastRaw = '';
  let stableCount = 0;

  logPopup('🔎 Memantau response Gemini untuk assignment_id_duplicate...', 'info');

  while (Date.now() < DEADLINE) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const r = await readGeminiResponse(tabId);
    if (!r) continue;

    if (r.found && r.codes.length) {
      // Stabil-check: raw sama 2x -> stream selesai.
      if (r.raw === lastRaw) {
        stableCount++;
      } else {
        stableCount = 1;
        lastRaw = r.raw;
      }
      if (stableCount >= 2) {
        logPopup(`✅ Gemini indikasi ${r.codes.length} duplikat: ${r.codes.join(', ')}`, 'success');
        chrome.runtime.sendMessage({ type: 'ASSIGN_DUP_CODES', codes: r.codes }).catch(() => {});
        return;
      }
    }
    // Kalau belum ketemu pola, lanjut poll (Gemini masih stream / bukan indikasi duplikat).
  }

  logPopup('⏱️ Tidak ada assignment_id_duplicate terdeteksi dalam 90 detik. Selesai.', 'warning');
  chrome.runtime.sendMessage({ type: 'ASSIGN_DUP_NONE' }).catch(() => {});
}
```

- [ ] **Step 3: Mulai poll setelah round-1 sendToGemini sukses**

Di `sendToGemini`, setelah badge sukses (`✓`), mulai poll. Modifikasi blok sukses di `sendToGemini`:

```javascript
    if (r && r.ok && r.sent) {
      logPopup(`✅ Terkirim ke Gemini ✔${r.hasButton ? '' : ' (via Enter)'}`, 'success');
      badge('✓', '#22c55e');
      // Mulai round-trip: poll response Gemini untuk assignment_id_duplicate.
      // Hanya untuk round-1 (meta.source !== 'extract'); round-2 tidak perlu poll lagi.
      if (!meta || meta.source !== 'extract') {
        pollGeminiResponse(tab.id).catch((e) => logPopup(`⚠️ Poll error: ${e.message}`, 'warning'));
      }
    }
```

(Catatan: `EXTRACT_DONE` kirim `meta = { source: 'extract' }` untuk round-2, jadi round-2 tidak trigger poll lagi — hindari loop tak terhingga.)

- [ ] **Step 4: Tambah `gemini-read.js` ke manifest web_accessible_resources** (kalau perlu — MAIN-world inject via `files` TIDAK butuh web_accessible_resources, hanya content-script-style inject. Skip bila tidak error.)

Sebenarnya `chrome.scripting.executeScript({ files })` MAIN-world **tidak** butuh web_accessible_resources. Verifikasi: bila inject gagal dengan "Cannot access", tambahkan. Default skip.

- [ ] **Step 5: Syntax check**

Run: `node --check extension/background.js` — expect exit 0.

- [ ] **Step 6: Commit**

```bash
git add extension/background.js
git commit -m "feat: background poll response Gemini + kirim ASSIGN_DUP_CODES ke popup"
```

---

## Task 4: popup.js handler round-trip (ASSIGN_DUP_CODES → loop → round 2)

**Files:** Modify `extension/popup.js`

- [ ] **Step 1: Tambah module-scope state untuk round-trip**

Di atas handler Ekstrak UUID (sekitar `let extractStopped`), tambah:

```javascript
let roundTripCodes = [];   // code dari Gemini response
let roundTripLinks = [];   // link hasil ekstraksi
let roundTripRunning = false;
```

- [ ] **Step 2: Refactor loop ekstraksi jadi fungsi reusable `runExtractLoop(codes, onLink)`**

Tarik badan loop dari `extractBtn` handler jadi fungsi terpisah supaya round-trip bisa pakai:

```javascript
async function runExtractLoop(tab, codes, searchDelay, modalDelay, onResult) {
  const results = [];
  for (let i = 0; i < codes.length; i++) {
    if (extractStopped) break;
    const code = codes[i];
    updateProgress(i, codes.length, `[${i + 1}/${codes.length}] ${code}`);
    appendLog(`▶ [${i + 1}/${codes.length}] ekstrak: ${code}`, 'info');
    try {
      const res = await chrome.tabs.sendMessage(tab.id, {
        type: 'NEXT_CODE', code, searchDelay, modalDelay,
      });
      if (res && res.status === 'ok') {
        const linkInfo = res.link ? ` (link: ${res.link.slice(0, 50)}...)` : ' (no link)';
        appendLog(`   ✅ ${code} → ${res.uuid || '(no uuid)'}${linkInfo}`, 'success');
      } else if (res && res.status === 'notfound') {
        appendLog(`   ⚠️ ${code} tidak ditemukan — skip`, 'warning');
      } else {
        appendLog(`   ⚠️ ${code} gagal: ${res?.reason || res?.status}`, 'warning');
      }
      results.push(res || { code, status: 'skip' });
      if (onResult) onResult(res, code);
    } catch (err) {
      appendLog(`   ❌ ${code} error: ${err.message}`, 'error');
      results.push({ code, status: 'skip', reason: err.message });
    }
  }
  updateProgress(codes.length, codes.length, 'Selesai');
  return results;
}
```

Lalu `extractBtn` handler panggil `runExtractLoop` (ganti badan loop-nya dengan pemanggilan fungsi). Setelah selesai, behavior lama: `formatExtractOutput` + `EXTRACT_DONE` round-1.

- [ ] **Step 3: Listener `ASSIGN_DUP_CODES` + `ASSIGN_DUP_NONE`**

Di `chrome.runtime.onMessage` listener, tambah cabang:

```javascript
  } else if (message.type === 'ASSIGN_DUP_CODES') {
    const codes = message.codes || [];
    if (!codes.length) { appendLog('ℹ️ Tidak ada code duplikat dari Gemini.', 'info'); return; }
    appendLog(`🔁 Round-trip: Gemini indikasi ${codes.length} duplikat. Mulai ekstraksi link...`, 'info');
    runRoundTrip(codes);
  } else if (message.type === 'ASSIGN_DUP_NONE') {
    appendLog('⏱️ Gemini tidak indikasi duplikat dalam 90s. Round-trip selesai.', 'warning');
    setStatus('idle');
  }
```

- [ ] **Step 4: Fungsi `runRoundTrip(codes)`**

```javascript
async function runRoundTrip(codes) {
  if (roundTripRunning) { appendLog('⚠️ Round-trip sudah berjalan.', 'warning'); return; }
  roundTripRunning = true;
  extractStopped = false;
  roundTripCodes = codes;
  roundTripLinks = [];

  const tab = await getFasihTab();
  if (!tab) {
    appendLog('❌ Tab FASIH tidak ditemukan untuk round-trip.', 'error');
    roundTripRunning = false;
    return;
  }
  const ok = await ensureContent(tab.id);
  if (!ok) { roundTripRunning = false; return; }

  const searchDelay = parseInt(cfgSearch.value, 10) || 1500;
  const modalDelay = parseInt(cfgModal.value, 10) || 2000;

  setStatus('running');
  extractBtn.disabled = true;
  extractStopBtn.disabled = false;
  progressSection.style.display = '';

  const results = await runExtractLoop(tab, codes, searchDelay, modalDelay, (res) => {
    if (res && res.status === 'ok' && res.link) roundTripLinks.push(res.link);
  });

  setStatus('done');
  extractBtn.disabled = false;
  extractStopBtn.disabled = true;
  roundTripRunning = false;

  if (extractStopped) {
    appendLog('⛔ Round-trip dihentikan.', 'warning');
    return;
  }

  // Round 2: paste link (dipisah ; ) ke Gemini.
  const links = roundTripLinks.filter(Boolean);
  if (!links.length) {
    appendLog('⚠️ Tidak ada link terkumpul. Round-2 dilewati.', 'warning');
    return;
  }
  const text = links.join(' ; ');
  appendLog(`➡️ Round 2: kirim ${links.length} link ke Gemini (dipisah ;).`, 'success');
  try {
    await chrome.runtime.sendMessage({ type: 'EXTRACT_DONE', text });
  } catch (err) {
    appendLog(`❌ Gagal kirim round-2: ${err.message}`, 'error');
  }
}
```

- [ ] **Step 5: `extractStopBtn` juga hentikan round-trip**

`extractStopped` sudah dipakai bersama — Stop otomatis menghentikan loop `runExtractLoop` (cek `if (extractStopped) break`). Pastikan `extractStopBtn` handler set `extractStopped = true` (sudah ada). Tidak perlu ubah.

- [ ] **Step 6: Syntax check**

Run: `node --check extension/popup.js` — expect exit 0.

- [ ] **Step 7: Commit**

```bash
git add extension/popup.js
git commit -m "feat: popup round-trip handler (ASSIGN_DUP_CODES -> loop link -> round 2)"
```

---

## Task 5: Verifikasi end-to-end manual

**Files:** (tidak ada — tes manual)

- [ ] **Step 1: Syntax semua**

Run: `cd extension && for f in content.js background.js popup.js interceptor.js gemini-read.js gemini-send.js; do node --check "$f" && echo "$f OK"; done && node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'));console.log('manifest OK')"`
Expected: semua OK.

- [ ] **Step 2: Reload extension**

`chrome://extensions` → refresh FASIH Quick Copy.

- [ ] **Step 3: 2 tab**

FASIH (halaman search) + Gemini (`gemini.google.com/app`).

- [ ] **Step 4: Round 1 → auto-poll**

Lakukan flow lama (Copy Sekarang / Mulai Batch / Ekstrak UUID) yang kirim ke Gemini. Setelah Gemini selesai generate, lihat popup log: `🔎 Memantau response Gemini...` → `✅ Gemini indikasi N duplikat: ...`.

- [ ] **Step 5: Auto-loop ekstraksi link**

Popup otomatis jalankan `runRoundTrip`. Log tiap code → `✅ {code} → {uuid} (link: ...)`. Link terkumpul.

- [ ] **Step 6: Round 2**

Link dipaste ke Gemini dipisah `;`, terkirim. Badge `✓`. Gemini balas dengan `assignment_id_duplicate: <UUID>; <UUID>`.

- [ ] **Step 7: Edge — no duplikat**

Kalau Gemini tidak indikasi duplikat: `⏱️ Tidak ada assignment_id_duplicate terdeteksi dalam 90 detik. Selesai.` (tidak crash).

- [ ] **Step 8: Catat selector yang gagal**

Kalau poll tidak menemukan `assignment_id_duplicate:` padahal ada → selector response Gemini salah. Dump `gemini-read.js` kandidat ke console, user kirim, saya kunci selector.

---

## Self-Review

**Spec coverage:**
- Auto-poll response Gemini → Task 3 (`pollGeminiResponse`) ✔
- Parse `assignment_id_duplicate: code; code` → Task 2 (regex) ✔
- doExtractCode return link → Task 1 ✔
- Loop ekstraksi reuse → Task 4 (`runExtractLoop`) ✔
- Round 2 paste link `;` → Task 4 (`runRoundTrip` + `EXTRACT_DONE`) ✔
- Hindari poll loop tak hingga (round-2 tidak trigger poll) → Task 3 (`meta.source !== 'extract'`) ✔
- Timeout 90s no-duplikat → Task 3 ✔

**Placeholder scan:** tidak ada TBD; semua step ada kode lengkap.

**Type consistency:** `doExtractCode` return `{ code, nama, uuid, link, status }` → `runExtractLoop` `onResult(res)` baca `res.link`/`res.uuid`/`res.status` ✔. `ASSIGN_DUP_CODES { codes }` background→popup ✔. `EXTRACT_DONE { text }` popup→background (round 2, `meta.source='extract'`) ✔.

**Risiko:** selector response Gemini belum diverifikasi (regex di teks response, bukan struktur DOM). Mitigasi: `gemini-read.js` fallback `document.body.innerText` + dump kandidat kalau gagal. Regex pada innerText handal terhadap struktur DOM.
