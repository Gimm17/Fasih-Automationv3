# FASIH UUID Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambah mode "Ekstrak UUID Assignment" ke extension v3: untuk tiap code usaha terindikasi duplikat (dari jawaban Gemini), otomasi search FASIH → buka detail → ekstrak UUID link assignment → kumpulkan → kirim ulang ke Gemini.

**Architecture:** Pendekatan A — popup orchestrate queue (kirim `NEXT_CODE` satu per satu), `content.js` FASIH jadi mesin ekstraksi (search→klik kartu→modal→Review→UUID→tutup). Output digabung + dikirim ulang ke Gemini via `sendToGemini` v3 yang sudah ada (MAIN-world paste+send). Reuse logika detail/modal dari `FASIH-AUTOMATION/extension/content.js`.

**Tech Stack:** Chrome Extension MV3, vanilla JS, `chrome.scripting`/`chrome.tabs`/`chrome.storage`.

---

## File Structure

| File | Tanggung jawab |
|---|---|
| `extension/interceptor.js` | **buat** (copy dari `FASIH-AUTOMATION/extension/interceptor.js`) — intercept `window.open` di page-context, postMessage URL ke content script (fallback ekstrak link). |
| `extension/manifest.json` | **ubah** — tambah `interceptor.js` ke `web_accessible_resources`. |
| `extension/content.js` | **ubah** — tambah: `isUUID`, `extractAssignmentIdFromReviewUrl`, `findReviewButton`, `waitForReviewButton`, `closeDetailModal`, `extractReviewLinkAddress`, `clickElement`, interceptor loader + state flag `shouldStopExtract`; listener `NEXT_CODE`/`STOP_EXTRACT`. |
| `extension/popup.html` | **ubah** — tambah section "Ekstrak UUID Assignment" (textarea + tombol + cfg modal). |
| `extension/popup.css` | **ubah** — minor (textarea/section sudah ada style, mungkin tambah spacing). |
| `extension/popup.js` | **ubah** — tambah handler Ekstrak: parse daftar → loop `NEXT_CODE` → akumulasi → `EXTRACT_DONE` ke background. |
| `extension/background.js` | **ubah** — tambah router `EXTRACT_DONE { text }` → `sendToGemini(text)` (reuse). |

---

## Task 1: Salin interceptor.js ke v3 + daftarkan di manifest

**Files:**
- Create: `extension/interceptor.js`
- Modify: `extension/manifest.json`

- [ ] **Step 1: Salin isi `interceptor.js` dari project lama**

`extension/interceptor.js` (isi sama persis dengan `FASIH-AUTOMATION/extension/interceptor.js`):

```javascript
// Intercepts window.open in the PAGE context so the content script can
// capture the URL FASIH tries to open when clicking "Review".
(function () {
  'use strict';
  const origOpen = window.open;
  window.open = function (url) {
    try {
      window.postMessage({ type: 'FASIH_CAPTURED_OPEN_URL', url: String(url || '') }, '*');
    } catch (_) {}
    return origOpen ? origOpen.apply(this, arguments) : null;
  };
})();
```

Jika isi lama berbeda, salin persis dari `C:\Users\HP\OneDrive\Documents\CODINGAN\BOT\FASIH-AUTOMATION\extension\interceptor.js`. Verifikasi dulu dengan Read sebelum menulis.

- [ ] **Step 2: Tambah `web_accessible_resources` ke manifest**

Edit `extension/manifest.json`, tambah root-level (setelah `content_scripts`):

```json
  "web_accessible_resources": [
    {
      "resources": ["interceptor.js"],
      "matches": ["https://fasih-sm.bps.go.id/*"]
    }
  ]
```

- [ ] **Step 3: Validasi JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('extension/manifest.json','utf8')); console.log('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add extension/interceptor.js extension/manifest.json
git commit -m "feat: salin interceptor window.open + daftarkan di manifest"
```

---

## Task 2: Tambah helper ekstrak (UUID, Review button, modal) ke content.js

**Files:**
- Modify: `extension/content.js` (sisipkan setelah blok `extractField`, sebelum `// CARD COLLECTION`)

- [ ] **Step 1: Tambah state flag ekstrak**

Edit `extension/content.js`, ubah blok `state` (line ~19):

```javascript
const state = {
  batchRunning: false,
  shouldStop:   false,
  shouldStopExtract: false,
};
```

- [ ] **Step 2: Sisipkan helper UUID + Review setelah `extractField` (sebelum `// CARD COLLECTION`)**

```javascript
// ============================================================
// DETAIL / REVIEW EXTRACTION (dari FASIH-AUTOMATION/content.js)
// ============================================================
function isUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(str || '').trim());
}

function extractAssignmentIdFromReviewUrl(url) {
  if (!url) return '';
  const clean = String(url).split('?')[0].split('#')[0];
  const parts = clean.split('/').filter((p) => p.length > 0);
  const assignIdx = parts.indexOf('assignment');
  if (assignIdx !== -1 && parts.length > assignIdx + 2) {
    const candidate = parts[assignIdx + 2];
    if (isUUID(candidate)) return candidate;
  }
  const lastPart = parts[parts.length - 1];
  if (isUUID(lastPart)) return lastPart;
  const uuids = url.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
  if (uuids && uuids.length >= 2) return uuids[uuids.length - 1];
  return uuids && uuids.length === 1 ? uuids[0] : '';
}

// Intercept window.open dari page-context (fallback ekstrak link Review).
let capturedWindowOpenUrl = '';
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data && event.data.type === 'FASIH_CAPTURED_OPEN_URL') {
    capturedWindowOpenUrl = String(event.data.url || '');
  }
});
(function loadInterceptorScript() {
  if (document.getElementById('fasih-interceptor-script')) return;
  try {
    const script = document.createElement('script');
    script.id = 'fasih-interceptor-script';
    script.src = chrome.runtime.getURL('interceptor.js');
    (document.head || document.documentElement).appendChild(script);
  } catch (_) {}
})();

function clickElement(el) {
  if (!el) return;
  if (el.tagName === 'A') {
    el.addEventListener('click', (e) => e.preventDefault(), { once: true, capture: true });
  }
  el.focus();
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  el.click();
}

function findReviewButton() {
  const bySource = document.querySelector('button[data-tsd-source*="assignment-action"]');
  if (bySource && bySource.textContent.includes('Review')) return bySource;
  const allClickables = document.querySelectorAll('button, a');
  for (const el of allClickables) {
    const txt = el.textContent?.trim() || '';
    if (txt === 'Review' || txt.includes('Review')) return el;
  }
  const telegramIcons = document.querySelectorAll('svg.tabler-icon-brand-telegram');
  for (const svg of telegramIcons) {
    const parentBtn = svg.closest('button') || svg.closest('a');
    if (parentBtn) return parentBtn;
  }
  return null;
}

async function waitForReviewButton(timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const btn = findReviewButton();
    if (btn) return btn;
    await delay(250);
  }
  return null;
}

function closeDetailModal() {
  const xIcons = document.querySelectorAll('svg.tabler-icon-x');
  for (const svg of xIcons) {
    const btn = svg.closest('button');
    if (btn) { clickElement(btn); return true; }
  }
  for (const span of document.querySelectorAll('span')) {
    if (span.textContent?.trim() === 'Close') {
      const btn = span.closest('button');
      if (btn) { clickElement(btn); return true; }
    }
  }
  const closeBtn = document.querySelector('button.f\\:top-4.f\\:right-4') ||
                   document.querySelector('button[class*="top-4"][class*="right-4"]');
  if (closeBtn) { clickElement(closeBtn); return true; }
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
  return false;
}

function extractReviewLinkAddress(reviewBtn, cardContainer) {
  const elements = [reviewBtn, cardContainer, document.querySelector('[role="dialog"]'), document.querySelector('[data-state="open"]')];
  for (const el of elements) {
    if (!el) continue;
    const anchor = el.closest?.('a') || el.querySelector?.('a') || (el.tagName === 'A' ? el : null);
    if (anchor && anchor.href && anchor.href.includes('/assignment/')) return anchor.href;
    const anyLink = el.querySelector?.('a[href*="/assignment/"]') || el.querySelector?.('a[href*="/data/"]');
    if (anyLink && anyLink.href) return anyLink.href;
    const attrs = ['href', 'data-href', 'data-url', 'to', 'action', 'data-link'];
    for (const attr of attrs) {
      const val = el.getAttribute?.(attr);
      if (val && val.includes('/assignment/')) return val;
    }
    for (const key of Object.keys(el)) {
      if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$') || key.startsWith('__reactProps$')) {
        const fiber = el[key];
        const checkProps = (p) => {
          if (!p) return '';
          if (typeof p.href === 'string' && p.href.includes('/assignment/')) return p.href;
          if (typeof p.to === 'string' && p.to.includes('/assignment/')) return p.to;
          if (typeof p.url === 'string' && p.url.includes('/assignment/')) return p.url;
          if (p.assignmentId) return `/app/assignment/${p.assignmentId}`;
          if (p.assignment?.id) return `/app/assignment/${p.assignment.id}`;
          if (p.data?.id) return `/app/assignment/${p.data.id}`;
          return '';
        };
        const res = checkProps(fiber?.memoizedProps) || checkProps(fiber?.pendingProps) || checkProps(fiber?.return?.memoizedProps);
        if (res) return res;
      }
    }
  }
  return '';
}
```

- [ ] **Step 3: Syntax check**

Run: `node --check extension/content.js`
Expected: (no output, exit 0)

- [ ] **Step 4: Commit**

```bash
git add extension/content.js
git commit -m "feat: helper ekstrak UUID/Review/modal di content.js"
```

---

## Task 3: doExtractCode + listener NEXT_CODE/STOP_EXTRACT di content.js

**Files:**
- Modify: `extension/content.js` (tambah fungsi + listener, sebelum blok `// LISTENER` akhir)

- [ ] **Step 1: Tambah `doExtractCode`**

Sisipkan sebelum `// ============================================================\n// LISTENER`:

```javascript
// ============================================================
// MODE EKSTRAK UUID
// ============================================================
async function findCardForCode(targetCode) {
  // Pakai collectCards untuk dapat semua kartu ter-render, cari yang cocok.
  const map = new Map();
  collectCards(map);
  const normTarget = normalizeCode(targetCode);
  for (const entry of map.values()) {
    const entryTitleCode = normalizeCode(extractCodeFromText(entry.title || ''));
    if (entryTitleCode === normTarget || entry.code === normTarget) {
      return entry;
    }
  }
  // Fallback: cari tombol judul yang teksnya diawali code target.
  const btns = Array.from(document.querySelectorAll('button[data-tsd-source*="assignment-list-item"]'));
  for (const b of btns) {
    const t = (b.textContent || '').replace(/\s+/g, ' ').trim();
    if (t.startsWith(targetCode)) {
      return { title: t, btn };
    }
  }
  return null;
}

async function doExtractCode(code, searchDelay, modalDelay) {
  const target = (String(code || '')).trim();
  if (!target) return { code, status: 'skip', reason: 'code kosong' };

  // 1. Search code di FASIH.
  const input = await getFreshSearchInput();
  if (!input) return { code, status: 'skip', reason: 'field search tidak ditemukan' };
  setInputValue(input, '');
  await delay(200);
  setInputValue(input, target);
  await delay(searchDelay);

  // 2. Cari kartu untuk code ini.
  //    Scroll sekali untuk pastikan render (daftar pendek biasanya langsung ada).
  const scrollMap = new Map();
  await autoScrollAll(scrollMap);
  const card = await findCardForCode(target);
  if (!card) return { code, status: 'notfound' };

  // 3. Klik tombol judul kartu untuk buka modal detail.
  const btnEl = card.btn ||
    Array.from(document.querySelectorAll('button[data-tsd-source*="assignment-list-item"]'))
      .find((b) => (b.textContent || '').trim().startsWith(target));
  if (!btnEl) return { code, status: 'skip', reason: 'tombol kartu tidak ditemukan' };
  clickElement(btnEl);
  await delay(modalDelay);

  // 4. Tunggu tombol Review di modal.
  const reviewBtn = await waitForReviewButton(modalDelay || 8000);
  let reviewUrl = reviewBtn ? extractReviewLinkAddress(reviewBtn, document.body) : '';
  if (!reviewUrl) reviewUrl = extractReviewLinkAddress(btnEl, btnEl);

  let uuid = reviewUrl ? extractAssignmentIdFromReviewUrl(reviewUrl) : '';

  // 5. Fallback: klik Review + tangkap window.open.
  if (!isUUID(uuid) && reviewBtn) {
    capturedWindowOpenUrl = '';
    clickElement(reviewBtn);
    await delay(1200);
    const openUrl = capturedWindowOpenUrl;
    if (openUrl) uuid = extractAssignmentIdFromReviewUrl(openUrl);
  }

  // 6. Tutup modal.
  closeDetailModal();
  await delay(400);

  const nama = card.nama || '';
  if (isUUID(uuid)) return { code, nama, uuid, status: 'ok' };
  return { code, nama, status: 'skip', reason: 'UUID tidak ter-ekstrak' };
}
```

- [ ] **Step 2: Tambah listener `NEXT_CODE` dan `STOP_EXTRACT`**

Edit blok `chrome.runtime.onMessage.addListener` (tambah 2 cabang sebelum `return false;` akhir):

```javascript
  if (message.type === 'NEXT_CODE') {
    state.shouldStopExtract = false;
    doExtractCode(message.code || '', message.searchDelay || 1500, message.modalDelay || 2000)
      .then((r) => sendResponse(r))
      .catch((err) => sendResponse({ code: message.code, status: 'skip', reason: String(err && err.message || err) }));
    return true;
  }

  if (message.type === 'STOP_EXTRACT') {
    state.shouldStopExtract = true;
    sendResponse({ ok: true });
    return true;
  }
```

- [ ] **Step 3: Syntax check**

Run: `node --check extension/content.js`
Expected: (no output, exit 0)

- [ ] **Step 4: Commit**

```bash
git add extension/content.js
git commit -m "feat: doExtractCode + listener NEXT_CODE/STOP_EXTRACT"
```

---

## Task 4: Background router EXTRACT_DONE

**Files:**
- Modify: `extension/background.js`

- [ ] **Step 1: Tambah cabang `EXTRACT_DONE` di `onMessage`**

Edit `chrome.runtime.onMessage.addListener` di `background.js`. Setelah blok `if (message.type === 'BATCH_DONE')`:

```javascript
  if (message.type === 'EXTRACT_DONE') {
    sendToGemini(message.text || '', { source: 'extract' });
  }
```

(`sendToGemini` sudah ada di v3, reuse — tidak diubah.)

- [ ] **Step 2: Syntax check**

Run: `node --check extension/background.js`
Expected: (no output, exit 0)

- [ ] **Step 3: Commit**

```bash
git add extension/background.js
git commit -m "feat: router EXTRACT_DONE ke sendToGemini"
```

---

## Task 5: Popup section "Ekstrak UUID Assignment" (HTML)

**Files:**
- Modify: `extension/popup.html`

- [ ] **Step 1: Tambah section Ekstrak (sisipkan setelah section Batch, sebelum progressSection)**

Edit `extension/popup.html`, sisipkan sebelum `<section class="section" id="progressSection"`:

```html
  <section class="section">
    <div class="section-title">Ekstrak UUID Assignment</div>
    <p class="hint">Paste daftar <b>code usaha terindikasi duplikat</b> dari jawaban Gemini (satu per baris). Extension cari tiap code di FASIH, buka detail, ekstrak UUID, lalu kirim ulang ke Gemini.</p>
    <textarea id="extractCodes" rows="5" placeholder="Satu code per baris, contoh:&#10;7271030002000300&#10;7271020008003401"></textarea>

    <div class="config-row">
      <label for="cfgModal">Delay modal (ms)</label>
      <input type="number" id="cfgModal" value="2000" min="500" step="100">
    </div>

    <div class="controls">
      <button class="btn btn-primary" id="extractBtn">▶&nbsp; Ekstrak UUID</button>
      <button class="btn btn-danger" id="extractStopBtn" disabled>⏹&nbsp; Stop</button>
    </div>
  </section>
```

- [ ] **Step 2: Commit**

```bash
git add extension/popup.html
git commit -m "feat: popup section Ekstrak UUID Assignment"
```

---

## Task 6: Popup handler Ekstrak (JS)

**Files:**
- Modify: `extension/popup.js`

- [ ] **Step 1: Tambah referensi elemen**

Edit blok referensi (sekitar line 10-16), tambah:

```javascript
const extractCodesEl = $('extractCodes');
const cfgModal       = $('cfgModal');
const extractBtn     = $('extractBtn');
const extractStopBtn = $('extractStopBtn');
```

- [ ] **Step 2: Tambah persist untuk extractCodes + cfgModal**

Ubah `PERSIST_KEYS`:

```javascript
const PERSIST_KEYS = ['dataAcuan', 'keywords', 'cfgSearch', 'extractCodes', 'cfgModal'];
```

Dan di blok restore (init), tambah:

```javascript
      if (fasihQC.extractCodes != null) extractCodesEl.value = fasihQC.extractCodes;
      if (fasihQC.cfgModal != null) cfgModal.value = fasihQC.cfgModal;
```

- [ ] **Step 3: Tambah handler Ekstrak + format output**

Sisipkan setelah handler `stopBtn.addEventListener('click', ...)` (atau setelah blok BATCH):

```javascript
// ============================================================
// EKSTRAK UUID
// ============================================================
function formatExtractOutput(dataAcuan, results) {
  const acuan = (String(dataAcuan || '')).trim();
  const lines = results.map((r) => {
    if (r.status === 'ok') return `${r.code} - ${r.nama || ''} - ${r.uuid}`;
    if (r.status === 'notfound') return `${r.code} - [TIDAK DITEMUKAN]`;
    return `${r.code} - ${r.nama || ''} - [GAGAL EKSTRAK]`;
  });
  const parts = [];
  if (acuan) parts.push(`"DATA ACUAN"\n${acuan}`);
  parts.push(`"UUID ASSIGNMENT (hasil ekstrak):"\n${lines.join('\n')}`);
  return parts.join('\n\n');
}

extractBtn.addEventListener('click', async () => {
  const raw = extractCodesEl.value.trim();
  if (!raw) { appendLog('❌ Paste minimal 1 code usaha dulu.', 'error'); return; }
  const codes = raw.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (!codes.length) { appendLog('❌ Tidak ada code valid.', 'error'); return; }

  const tab = await getFasihTab();
  if (!tab) { appendLog('❌ Tab FASIH tidak ditemukan. Buka fasih-sm.bps.go.id dulu.', 'error'); return; }
  const ok = await ensureContent(tab.id);
  if (!ok) return;

  const searchDelay = parseInt(cfgSearch.value, 10) || 1500;
  const modalDelay = parseInt(cfgModal.value, 10) || 2000;

  setStatus('running');
  extractBtn.disabled = true;
  extractStopBtn.disabled = false;
  progressSection.style.display = '';
  updateProgress(0, codes.length, 'Memulai ekstrak...');

  appendLog(`🚀 Ekstrak UUID: ${codes.length} code (delay search ${searchDelay}ms, modal ${modalDelay}ms).`, 'info');

  const results = [];
  let stopped = false;
  for (let i = 0; i < codes.length; i++) {
    if (stopped) break;
    const code = codes[i];
    updateProgress(i, codes.length, `[${i + 1}/${codes.length}] ${code}`);
    appendLog(`▶ [${i + 1}/${codes.length}] ekstrak: ${code}`, 'info');
    try {
      const res = await chrome.tabs.sendMessage(tab.id, {
        type: 'NEXT_CODE', code, searchDelay, modalDelay,
      });
      if (res && res.status === 'ok') {
        appendLog(`   ✅ ${code} → ${res.uuid}`, 'success');
      } else if (res && res.status === 'notfound') {
        appendLog(`   ⚠️ ${code} tidak ditemukan — skip`, 'warning');
      } else {
        appendLog(`   ⚠️ ${code} gagal: ${res?.reason || res?.status}`, 'warning');
      }
      results.push(res || { code, status: 'skip' });
    } catch (err) {
      appendLog(`   ❌ ${code} error: ${err.message}`, 'error');
      results.push({ code, status: 'skip', reason: err.message });
    }
  }

  updateProgress(codes.length, codes.length, 'Selesai');
  setStatus('done');
  extractBtn.disabled = false;
  extractStopBtn.disabled = true;

  const text = formatExtractOutput(dataAcuanEl.value, results);
  const okCount = results.filter((r) => r.status === 'ok').length;
  appendLog(`🏁 Ekstrak selesai: ${okCount}/${codes.length} UUID dapat. Mengirim ke Gemini...`, 'success');

  try {
    await chrome.runtime.sendMessage({ type: 'EXTRACT_DONE', text });
  } catch (err) {
    appendLog(`❌ Gagal kirim ke background: ${err.message}`, 'error');
  }
});

extractStopBtn.addEventListener('click', async () => {
  const tab = await getFasihTab();
  if (tab) chrome.tabs.sendMessage(tab.id, { type: 'STOP_EXTRACT' }).catch(() => {});
  appendLog('⛔ Stop ekstrak diminta.', 'warning');
  setStatus('stopped');
  extractBtn.disabled = false;
  extractStopBtn.disabled = true;
});
```

- [ ] **Step 4: Tambah handler pesan `EXTRACT_DONE` status (opsional, background sudah log via LOG)**

Tidak perlu — `sendToGemini` di background sudah kirim `LOG` ke popup untuk status kirim Gemini. Tidak ada tipe baru yang harus popup tangani.

- [ ] **Step 5: Syntax check**

Run: `node --check extension/popup.js`
Expected: (no output, exit 0)

- [ ] **Step 6: Commit**

```bash
git add extension/popup.js
git commit -m "feat: popup handler Ekstrak UUID + format output"
```

---

## Task 7: Verifikasi end-to-end manual

**Files:** (tidak ada — tes manual di browser)

- [ ] **Step 1: Cek sintaks semua**

Run: `cd extension && for f in content.js background.js popup.js interceptor.js; do node --check "$f" && echo "$f OK"; done && node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'));console.log('manifest OK')"`
Expected: semua OK.

- [ ] **Step 2: Reload extension**

`chrome://extensions` → klik refresh di kartu FASIH Quick Copy.

- [ ] **Step 3: Siapkan 2 tab**

Tab FASIH (halaman search/hasil) + tab Gemini (`gemini.google.com/app`).

- [ ] **Step 4: Tes Ekstrak dengan code yang ADA**

Popup → section "Ekstrak UUID Assignment" → paste 2-3 code yang pasti ada di FASIH → "Ekstrak UUID". Amati log popup: tiap code → `✅ {code} → {uuid}`. Bandingkan 1 UUID manual: klik kartu itu di FASIH → tombol Review → copy link address → UUID setelah slash terakhir harus SAMA dengan output log.

- [ ] **Step 5: Tes code TIDAK ADA**

Tambah 1 code fiktif ke daftar → Ekstrak → harus `⚠️ {code} tidak ditemukan — skip`, batch lanjut.

- [ ] **Step 6: Tes auto-send Gemini**

Setelah selesai, tab Gemini harus aktif, teks "DATA ACUAN + UUID ASSIGNMENT (hasil ekstrak):" masuk ke kotak prompt, terkirim. Lihat badge: `✓` sukses.

- [ ] **Step 7: Catat selector yang gagal (kalau ada)**

Kalau ada code yang seharusnya ada tapi ber-status `skip` (UUID tidak ter-ekstrak), catat: buka manual detail kartu itu di FASIH → screenshot modal + Inspect tombol Review → kirim ke developer untuk kunci selector ulang. Ini risiko terdokumentasi di spec.

- [ ] **Step 8: Commit final (kalau ada perbaikan selector dari tes)**

Jika tes buka perbaikan, commit. Jika tidak, lewati.

```bash
git add -A
git commit -m "fix: selector review/modal sesuai tes (jika ada)"
```

---

## Self-Review

**Spec coverage:**
- Sumber code dari Gemini (textarea extractCodes) → Task 5/6 ✔
- Auto search→detail→Review→UUID → Task 3 (`doExtractCode`) ✔
- Kirim ulang ke Gemini → Task 4 (`EXTRACT_DONE`→`sendToGemini`) + Task 6 kirim ✔
- Status ok/notfound/skip → Task 3 return + Task 6 format ✔
- Data Acuan tetap dikirim → Task 6 `formatExtractOutput` ✔
- Delay configurable (search+modal) → Task 5 cfg + Task 6 baca ✔
- Stop → Task 3 `STOP_EXTRACT` + Task 6 stopBtn ✔
- Reuse `sendToGemini`/`FASIH_FILL_GEMINI` → Task 4 (tidak ubah) ✔
- Interceptor fallback → Task 1 (copy) + Task 2 (loader) ✔

**Placeholder scan:** tidak ada TBD/TODO; semua step ada kode lengkap.

**Type consistency:** `doExtractCode` return `{ code, nama, uuid, status }` (status ok/notfound/skip) → `formatExtractOutput` pakai `r.status/r.nama/r.uuid/r.code` sama. `NEXT_CODE` payload `{ code, searchDelay, modalDelay }` dikirim popup (Task 6) → diterima content (Task 3) field sama. `EXTRACT_DONE { text }` popup (Task 6) → background (Task 4) field sama.
