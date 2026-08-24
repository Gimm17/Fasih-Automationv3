/**
 * FASIH Quick Copy — content.js v2 (permanen di FASIH-SM)
 *
 * Dua mode:
 *  1. COPY_NOW  -> scrape hasil query yang sedang tampil -> copy clipboard.
 *  2. START_BATCH { keywords, searchDelay } -> isi field search satu per satu,
 *     scrape semua hasil tiap keyword, gabung -> kirim BATCH_DONE ke background.
 *
 * Logika parse card & format dipindahkan dari scraper.js (versi terbaru:
 * key = teks tombol judul, dedup per baris). Logika search & React input
 * dipinjam dari FASIH-AUTOMATION/content.js (setInputValue, getFreshSearchInput).
 */

'use strict';

// ============================================================
// STATE
// ============================================================
const state = {
  batchRunning: false,
  shouldStop:   false,
  shouldStopExtract: false,
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================
// UTILITIES
// ============================================================
function normalizeCode(code) {
  if (!code) return '';
  return String(code).replace(/^\d{4,}\s*[-–—]\s*/g, '').trim();
}

function extractCodeFromText(text) {
  if (!text) return '';
  const seMatch = text.match(/SE[0-9a-zA-Z]{5,}/i);
  if (seMatch) return seMatch[0];
  const dashMatch = text.match(/^\s*(\d{4,})\s*[-–—]/);
  if (dashMatch) return dashMatch[1];
  const d16 = text.match(/\b(\d{16})\b/);
  if (d16) return d16[1];
  return '';
}

const FASIH_ORIGIN = 'https://fasih-sm.bps.go.id';
function toAbsoluteUrl(u) {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;          // sudah absolute
  if (u.startsWith('//')) return 'https:' + u;     // protocol-relative
  if (u.startsWith('/')) return FASIH_ORIGIN + u;  // root-relative
  return FASIH_ORIGIN + '/' + u;                   // path-relative
}

function extractField(container, labelText) {
  if (!container) return '';
  const esc = labelText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nextLabelPattern =
    '(?=Nama\\s*Keluarga|Alamat\\s*Prelist|Nomor\\s*Urut|NIB\\s*/\\s*No\\.?\\s*KK|Email|Skala\\s*Usaha|Jumlah\\s*Usaha|Kode\\s*Pos|Perubahan\\s*SLS|$)';
  const re = new RegExp(esc + '\\s*[:\\n]?' + '([^\\n]*?)' + nextLabelPattern, 'i');

  const labels = container.querySelectorAll('span, label, dt, p, div, b, strong');
  for (const el of labels) {
    const t = (el.textContent || '').trim();
    if (new RegExp('^' + esc + '$', 'i').test(t)) {
      let nxt = el.nextElementSibling;
      if (nxt && nxt.textContent && nxt.textContent.trim()) {
        return nxt.textContent.replace(/\s+/g, ' ').trim();
      }
    }
  }

  const text = (container.innerText || container.textContent || '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ');
  const m = text.match(re);
  if (m && m[1]) return m[1].trim();
  return '';
}

// --- React-controlled search input (dari project lama) -----------------
function setInputValue(input, value) {
  if (!input || !input.isConnected) return false;
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  ).set;
  nativeSetter.call(input, value);
  input.dispatchEvent(new Event('input',  { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  if (input.value !== value) {
    input.focus();
    nativeSetter.call(input, value);
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return input.value === value;
}

function getSearchInput() {
  return (
    document.querySelector('input[placeholder="Cari..."]') ||
    document.querySelector('input[data-tsd-source*="filter-search"]')
  );
}

async function getFreshSearchInput(timeout = 8000) {
  const direct = getSearchInput();
  if (direct && direct.isConnected) return direct;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const el = getSearchInput();
    if (el && el.isConnected) return el;
    await delay(300);
  }
  return null;
}

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
// Guard: popup.js dapat re-inject content.js (PING gagal) -> cegah listener
// dobel & re-deklarasi let.
let capturedWindowOpenUrl = '';
if (!window.__fasih_content_msg_listener) {
  window.__fasih_content_msg_listener = true;
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data && event.data.type === 'FASIH_CAPTURED_OPEN_URL') {
      capturedWindowOpenUrl = String(event.data.url || '');
    }
  });
}
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

// ============================================================
// CARD COLLECTION (dari scraper.js versi terbaru)
// ============================================================
function collectCards(into) {
  // Kunci = TEKS TOMBOL JUDUL utuh ("KODE - SKALA - NO_URUT"), unik per baris.
  // Satu bangunan bisa punya >1 entri berkode sama -> kunci pakai kode akan
  // menimpa entri. Koleksi langsung dari tombol judul.
  const byRow = into || new Map();
  const buttons = Array.from(document.querySelectorAll(
    'button[data-tsd-source*="assignment-list-item"]'
  ));

  for (const btn of buttons) {
    const title = (btn.textContent || '').replace(/\s+/g, ' ').trim();
    if (!title || !/^\d{4,}\s*[-–—]/.test(title)) continue;

    const code = normalizeCode(extractCodeFromText(title));
    const rowKey = title;

    let container = btn;
    while (container && container !== document.body) {
      if (/nama\s*keluarga/i.test(container.innerText || '')) break;
      container = container.parentElement;
    }

    const nama   = extractField(container, 'Nama Keluarga/Bangunan/Usaha');
    const alamat = extractField(container, 'Alamat Prelist');
    const idsbr  = extractField(container, 'Nomor Urut Bangunan / IDSBR');
    const nib    = extractField(container, 'NIB / No. KK');
    const email  = extractField(container, 'Email');
    const skala  = extractField(container, 'Skala Usaha / Jenis Prelist');
    const jumlah = extractField(container, 'Jumlah Usaha');
    const kodepos= extractField(container, 'Kode Pos');
    const sls    = extractField(container, 'Perubahan SLS');

    const entry = { code, title, nama, alamat, idsbr, nib, email, skala, jumlah, kodepos, sls };
    const existing = byRow.get(rowKey);
    if (!existing) {
      byRow.set(rowKey, entry);
    } else {
      for (const k of Object.keys(entry)) {
        const nv = entry[k];
        const ov = existing[k];
        if (nv && nv !== '' && nv !== '-' && nv !== ov) existing[k] = nv;
      }
    }
  }

  return byRow;
}

// ============================================================
// AUTO-SCROLL (render semua item virtualized)
// ============================================================
async function autoScrollAll(accumulated) {
  const findScrollContainer = () =>
    Array.from(document.querySelectorAll('div'))
      .filter((el) => {
        const s = window.getComputedStyle(el);
        return (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight + 10 &&
          el.querySelector('button[data-tsd-source*="assignment-list-item"], li');
      })
      .sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || null;

  let start = Date.now();
  while (Date.now() - start < 8000 && accumulated.size === 0) {
    collectCards(accumulated);
    await delay(300);
  }
  collectCards(accumulated);

  // Reset ke atas dulu supaya urutan mulai dari hasil #1.
  const listEl = findScrollContainer();
  if (listEl) {
    listEl.scrollTop = 0;
    await delay(500);
  }
  accumulated.clear();
  collectCards(accumulated);

  const MAX_ITERATIONS = 200;
  const DEADLINE = Date.now() + 30000;
  let container = findScrollContainer();
  let stagnantRounds = 0;

  for (let i = 0; i < MAX_ITERATIONS && Date.now() < DEADLINE; i++) {
    const beforeCount = accumulated.size;
    const beforeTop = container ? container.scrollTop : -1;

    if (container) {
      container.scrollTop += container.clientHeight;
    } else {
      window.scrollBy(0, Math.round(window.innerHeight * 0.8));
    }
    await delay(450);
    container = findScrollContainer() || container;
    collectCards(accumulated);

    const moved = container ? container.scrollTop !== beforeTop : true;
    if (accumulated.size === beforeCount && !moved) {
      stagnantRounds++;
      if (stagnantRounds >= 3) break;
    } else {
      stagnantRounds = 0;
    }
  }

  await delay(300);
  collectCards(accumulated);
  if (container) container.scrollTop = 0; else window.scrollTo(0, 0);
  await delay(250);
  collectCards(accumulated);
}

// ============================================================
// TEXT FORMATTING
// ============================================================
const DASH = '-';
function v(x) {
  const s = String(x || '').trim();
  return s.length > 0 ? s : DASH;
}

function formatEntry(e) {
  const summary = e.title && /^\d{4,}/.test(e.title)
    ? e.title
    : [e.code, v(e.nama), v(e.idsbr), v(e.sls)].join(' - ');
  const detail = [
    'Nama Keluarga/Bangunan/Usaha', v(e.nama),
    'Alamat Prelist', v(e.alamat),
    'Nomor Urut Bangunan / IDSBR', v(e.idsbr),
    'NIB / No. KK', v(e.nib),
    'Email', v(e.email),
    'Skala Usaha / Jenis Prelist', v(e.skala),
    'Jumlah Usaha', v(e.jumlah),
    'Kode Pos', v(e.kodepos),
    'Perubahan SLS', v(e.sls),
  ].join('\n');
  return `${summary}\n---\n${detail}`;
}

function buildOutput(entries) {
  return entries.map(formatEntry).join('\n\n');
}

// Bungkus output dengan header "DATA ACUAN" + "HASIL QUERY:".
// dataAcuan = teks dari form input popup (header tetap, tidak berubah).
function buildWithHeader(entries, dataAcuan) {
  const acuan = (String(dataAcuan || '')).trim();
  const hasil = buildOutput(entries);
  const parts = [];
  if (acuan) parts.push(`"DATA ACUAN"\n${acuan}`);
  parts.push(`"HASIL QUERY:"\n${hasil}`);
  return parts.join('\n\n');
}

// ============================================================
// CLIPBOARD
// ============================================================
async function copyToClipboard(text) {
  try { window.focus(); } catch (_) {}
  await delay(150);
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (err) {
      console.error('[FASIH Quick Copy] Clipboard fallback gagal:', err);
      return false;
    }
  }
}

// ============================================================
// MESSAGING (ke popup/background)
// ============================================================
function logToPopup(message, level = 'info') {
  chrome.runtime.sendMessage({ type: 'LOG', message, level }).catch(() => {});
}

// ============================================================
// MODE COPY NOW
// ============================================================
async function doCopyNow(dataAcuan) {
  const map = new Map();
  await autoScrollAll(map);
  const entries = Array.from(map.values());
  if (entries.length === 0) {
    return { ok: false, error: 'Tidak ada hasil ditemukan' };
  }
  const text = buildWithHeader(entries, dataAcuan);
  const copied = await copyToClipboard(text);
  if (!copied) return { ok: false, message: 'Clipboard gagal' };
  return { ok: true, count: entries.length };
}

// ============================================================
// MODE BATCH
// ============================================================
async function doBatch(keywords, searchDelay, dataAcuan) {
  state.batchRunning = true;
  state.shouldStop = false;

  const blocks = [];
  let total = 0;

  logToPopup(`🚀 Batch mulai: ${keywords.length} keyword`, 'info');

  for (let i = 0; i < keywords.length; i++) {
    if (state.shouldStop) {
      logToPopup('⛔ Dihentikan pengguna.', 'warning');
      break;
    }
    const kw = keywords[i].trim();
    if (!kw) continue;

    chrome.runtime.sendMessage({ type: 'PROGRESS', current: i + 1, total: keywords.length, status: `[${i + 1}/${keywords.length}] "${kw}"` }).catch(() => {});
    logToPopup(`▶ [${i + 1}/${keywords.length}] cari: "${kw}"`, 'info');

    const input = await getFreshSearchInput();
    if (!input) {
      logToPopup('❌ Field search "Cari..." tidak ditemukan — skip', 'error');
      continue;
    }
    setInputValue(input, '');
    await delay(200);
    setInputValue(input, kw);
    await delay(searchDelay);

    const map = new Map();
    await autoScrollAll(map);
    const entries = Array.from(map.values());
    logToPopup(`   📋 ${entries.length} hasil untuk "${kw}"`, entries.length ? 'success' : 'info');
    if (entries.length) {
      blocks.push(entries.map(formatEntry).join('\n\n'));
      total += entries.length;
    }
  }

  const rawHasil = blocks.join('\n\n');
  state.batchRunning = false;

  // Bungkus: "DATA ACUAN" (header tetap dari form popup) + "HASIL QUERY:".
  const acuan = (String(dataAcuan || '')).trim();
  const parts = [];
  if (acuan) parts.push(`"DATA ACUAN"\n${acuan}`);
  parts.push(`"HASIL QUERY:"\n${rawHasil}`);
  const text = parts.join('\n\n');

  // Backup: salin juga ke clipboard bawaan supaya user bisa paste manual
  // kalau auto-send ke Gemini gagal (jaga-jaga).
  if (text.trim()) {
    const ok = await copyToClipboard(text);
    logToPopup(
      ok ? `📋 Backup: ${text.length} char juga ter-copy ke clipboard (paste manual = Ctrl+V).` : '⚠️ Backup clipboard gagal.',
      ok ? 'info' : 'warning'
    );
  }

  chrome.runtime.sendMessage({
    type: 'BATCH_DONE',
    text,
    total,
    keywordsCount: keywords.length,
    stopped: state.shouldStop,
  }).catch(() => {});

  logToPopup(`🏁 Batch selesai: ${total} hasil total.`, 'success');
}

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
      return { title: t };
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
  const reviewBtn = await waitForReviewButton(Math.max(8000, modalDelay));
  let reviewUrl = reviewBtn ? extractReviewLinkAddress(reviewBtn, document.body) : '';
  if (!reviewUrl) reviewUrl = extractReviewLinkAddress(btnEl, btnEl);

  // Absolute-kan URL relative dari React props (mis. "/app/assignment/.../...").
  reviewUrl = toAbsoluteUrl(reviewUrl);

  let uuid = reviewUrl ? extractAssignmentIdFromReviewUrl(reviewUrl) : '';

  // 5. Fallback: klik Review + tangkap window.open.
  if (!isUUID(uuid) && reviewBtn) {
    capturedWindowOpenUrl = '';
    clickElement(reviewBtn);
    await delay(1200);
    const openUrl = capturedWindowOpenUrl;
    if (openUrl) {
      const abs = toAbsoluteUrl(openUrl);
      uuid = extractAssignmentIdFromReviewUrl(abs);
      if (!reviewUrl) reviewUrl = abs;
    }
  }

  // 6. Tutup modal.
  closeDetailModal();
  await delay(400);

  const nama = card.nama || '';
  if (reviewUrl) return { code, nama, uuid, link: reviewUrl, status: 'ok' };
  if (isUUID(uuid)) return { code, nama, uuid, link: '', status: 'ok' };
  return { code, nama, status: 'skip', reason: 'UUID/link tidak ter-ekstrak' };
}

// ============================================================
// LISTENER
// ============================================================
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ ok: true, running: state.batchRunning });
    return true;
  }

  if (message.type === 'COPY_NOW') {
    doCopyNow(message.dataAcuan || '')
      .then((r) => sendResponse(r))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // async
  }

  if (message.type === 'START_BATCH') {
    if (state.batchRunning) {
      sendResponse({ ok: false, error: 'Batch sudah berjalan' });
      return true;
    }
    doBatch(message.keywords || [], message.searchDelay || 1500, message.dataAcuan || '');
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'STOP_BATCH') {
    state.shouldStop = true;
    state.batchRunning = false;
    sendResponse({ ok: true });
    return true;
  }

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

  return false;
});

console.log('[FASIH Quick Copy v2] Content script loaded ✔');
