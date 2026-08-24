/**
 * FASIH Quick Copy — popup.js v2
 * UI: Copy Sekarang + Batch multi-keyword + progress/log.
 */

'use strict';

const $ = (id) => document.getElementById(id);

const copyNowBtn   = $('copyNowBtn');
const keywordsEl   = $('keywords');
const dataAcuanEl  = $('dataAcuan');
const cfgSearch    = $('cfgSearch');
const startBtn     = $('startBtn');
const stopBtn      = $('stopBtn');
const statusDot    = $('statusDot');
const statusLabel  = $('statusLabel');

const progressSection = $('progressSection');
const progressBar     = $('progressBar');
const progressCount   = $('progressCount');
const progressPct     = $('progressPct');
const progressStatus  = $('progressStatus');

const logSection = $('logSection');
const logPanel   = $('logPanel');
const clearLogBtn = $('clearLogBtn');

const extractCodesEl = $('extractCodes');
const cfgModal       = $('cfgModal');
const extractBtn     = $('extractBtn');
const extractStopBtn = $('extractStopBtn');

const FASIH_HOST = 'fasih-sm.bps.go.id';

// ============================================================
// STATUS
// ============================================================
function setStatus(state) {
  const states = {
    idle:    { cls: 'idle',    label: 'Idle' },
    running: { cls: 'running', label: 'Running' },
    stopped: { cls: 'stopped', label: 'Stopped' },
    done:    { cls: 'done',    label: 'Done' },
  };
  const s = states[state] || states.idle;
  statusDot.className = `status-dot ${s.cls}`;
  statusLabel.textContent = s.label;
}

// ============================================================
// LOG
// ============================================================
function appendLog(message, level = 'info') {
  logSection.style.display = '';
  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;
  const d = new Date();
  const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
  entry.innerHTML = `<span class="log-time">${time}</span><span class="log-msg">${escapeHtml(message)}</span>`;
  logPanel.appendChild(entry);
  logPanel.scrollTop = logPanel.scrollHeight;
  while (logPanel.children.length > 200) logPanel.removeChild(logPanel.firstChild);
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function updateProgress(current, total, status) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  progressBar.style.width = `${pct}%`;
  progressCount.textContent = `${current} / ${total}`;
  progressPct.textContent = `${pct}%`;
  progressStatus.textContent = status || '';
}

clearLogBtn.addEventListener('click', () => { logPanel.innerHTML = ''; });

// ============================================================
// AMBIL TAB FASIH AKTIF
// ============================================================
async function getFasihTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url && tab.url.includes(FASIH_HOST)) return tab;
  // Cari tab FASIH apa pun.
  const tabs = await chrome.tabs.query({ url: '*://fasih-sm.bps.go.id/*' });
  return tabs[0] || null;
}

async function ensureContent(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (res && res.ok) return true;
  } catch (_) {}
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await new Promise((r) => setTimeout(r, 300));
    return true;
  } catch (err) {
    appendLog(`❌ Gagal inject content script: ${err.message}`, 'error');
    return false;
  }
}

// ============================================================
// COPY NOW
// ============================================================
copyNowBtn.addEventListener('click', async () => {
  copyNowBtn.disabled = true;
  const tab = await getFasihTab();
  if (!tab) {
    appendLog('❌ Tab FASIH tidak ditemukan. Buka fasih-sm.bps.go.id dulu.', 'error');
    copyNowBtn.disabled = false;
    return;
  }
  const ok = await ensureContent(tab.id);
  if (!ok) { copyNowBtn.disabled = false; return; }

  appendLog('📋 Mengambil hasil query saat ini...', 'info');
  try {
    const res = await chrome.tabs.sendMessage(tab.id, {
      type: 'COPY_NOW',
      dataAcuan: dataAcuanEl.value || '',
    });
    if (res && res.ok) {
      appendLog(`✅ ${res.count} hasil ter-copy (Data Acuan + hasil). Paste (Ctrl+V).`, 'success');
    } else {
      appendLog(`❌ Gagal: ${res?.error || 'tidak diketahui'}`, 'error');
    }
  } catch (err) {
    appendLog(`❌ ${err.message}`, 'error');
  }
  copyNowBtn.disabled = false;
});

// ============================================================
// BATCH
// ============================================================
startBtn.addEventListener('click', async () => {
  const raw = keywordsEl.value.trim();
  if (!raw) {
    appendLog('❌ Isi minimal 1 keyword dulu.', 'error');
    return;
  }
  const keywords = raw.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (!keywords.length) {
    appendLog('❌ Tidak ada keyword valid.', 'error');
    return;
  }

  const tab = await getFasihTab();
  if (!tab) {
    appendLog('❌ Tab FASIH tidak ditemukan. Buka fasih-sm.bps.go.id dulu.', 'error');
    return;
  }
  const ok = await ensureContent(tab.id);
  if (!ok) return;

  const searchDelay = parseInt(cfgSearch.value, 10) || 1500;
  const dataAcuan = dataAcuanEl.value || '';

  setStatus('running');
  startBtn.disabled = true;
  stopBtn.disabled = false;
  progressSection.style.display = '';
  updateProgress(0, keywords.length, 'Memulai...');

  appendLog(`🚀 Mulai batch ${keywords.length} keyword (delay ${searchDelay}ms).${dataAcuan.trim() ? ' Data Acuan dilampirkan.' : ''}`, 'info');

  try {
    const res = await chrome.tabs.sendMessage(tab.id, {
      type: 'START_BATCH',
      keywords,
      searchDelay,
      dataAcuan,
    });
    if (!res || !res.ok) {
      appendLog(`❌ Batch tidak dimulai: ${res?.error || 'gagal'}`, 'error');
      setStatus('idle');
      startBtn.disabled = false;
      stopBtn.disabled = true;
    }
  } catch (err) {
    appendLog(`❌ ${err.message}`, 'error');
    setStatus('idle');
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
});

stopBtn.addEventListener('click', async () => {
  const tab = await getFasihTab();
  if (tab) chrome.tabs.sendMessage(tab.id, { type: 'STOP_BATCH' }).catch(() => {});
  appendLog('⛔ Stop diminta.', 'warning');
  setStatus('stopped');
  startBtn.disabled = false;
  stopBtn.disabled = true;
});

// ============================================================
// EKSTRAK UUID
// ============================================================
let extractStopped = false;

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

  extractStopped = false;
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
  extractStopped = true;
  const tab = await getFasihTab();
  if (tab) chrome.tabs.sendMessage(tab.id, { type: 'STOP_EXTRACT' }).catch(() => {});
  appendLog('⛔ Stop ekstrak diminta.', 'warning');
  setStatus('stopped');
  extractBtn.disabled = false;
  extractStopBtn.disabled = true;
});

// ============================================================
// PESAN MASUK (dari content/background)
// ============================================================
chrome.runtime.onMessage.addListener((message) => {
  if (!message) return;
  if (message.type === 'LOG') {
    appendLog(message.message, message.level || 'info');
  } else if (message.type === 'PROGRESS') {
    updateProgress(message.current, message.total, message.status);
  } else if (message.type === 'BATCH_DONE') {
    // Diteruskan background -> Gemini; di sini hanya status UI.
    setStatus('done');
    startBtn.disabled = false;
    stopBtn.disabled = true;
    updateProgress(message.keywordsCount || 0, message.keywordsCount || 0, 'Selesai');
    if (message.stopped) appendLog('⛔ Batch dihentikan.', 'warning');
  } else if (message.type === 'GEMINI_PROBE_DONE') {
    const p = message.probe || {};
    appendLog(`🔎 Probe Gemini selesai: ${p.inputCandidates?.length || 0} input, ${p.buttonCandidates?.length || 0} tombol. Lihat console Gemini (Ctrl+Shift+J).`, 'success');
  } else if (message.type === 'GEMINI_TAB_NOT_FOUND') {
    appendLog('❌ Tab Gemini tidak ada. Buka gemini.google.com, lalu Mulai Batch lagi.', 'error');
    setStatus('stopped');
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
});

// ============================================================
// PERSIST (Data Acuan & keyword agar tidak hilang saat popup ditutup)
// ============================================================
const PERSIST_KEYS = ['dataAcuan', 'keywords', 'cfgSearch', 'extractCodes', 'cfgModal'];
function savePersist() {
  const obj = {};
  PERSIST_KEYS.forEach((k) => {
    const el = $(k);
    if (el) obj[k] = el.value;
  });
  try { chrome.storage.local.set({ fasihQC: obj }); } catch (_) {}
}
[PERSIST_KEYS].flat().forEach((k) => {
  const el = $(k);
  if (el) el.addEventListener('input', savePersist);
});

// ============================================================
// INIT
// ============================================================
(async () => {
  // Restore nilai tersimpan.
  try {
    const { fasihQC } = await chrome.storage.local.get('fasihQC');
    if (fasihQC) {
      if (fasihQC.dataAcuan != null) dataAcuanEl.value = fasihQC.dataAcuan;
      if (fasihQC.keywords != null) keywordsEl.value = fasihQC.keywords;
      if (fasihQC.cfgSearch != null) cfgSearch.value = fasihQC.cfgSearch;
      if (fasihQC.extractCodes != null) extractCodesEl.value = fasihQC.extractCodes;
      if (fasihQC.cfgModal != null) cfgModal.value = fasihQC.cfgModal;
    }
  } catch (_) {}

  const tab = await getFasihTab();
  if (!tab) {
    appendLog('ℹ️ Buka tab FASIH (fasih-sm.bps.go.id) untuk mulai.', 'info');
  }
  setStatus('idle');
})();
