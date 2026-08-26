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
let roundTripRunning = false;
let roundTripLinks = [];

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
        appendLog(`   ✅ ${code} → ${res.uuid || '(no uuid)'}${res.link ? ' (link)' : ''}`, 'success');
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

extractBtn.addEventListener('click', async () => {
  const raw = extractCodesEl.value.trim();
  if (!raw) { appendLog('❌ Paste minimal 1 code usaha dulu.', 'error'); return; }
  const codes = raw.split(/\n+/)
    .map((s) => s.trim().replace(/^\d+[.)]\s*/, '')) // buang "1. " / "1) " dari list Gemini
    .filter(Boolean);
  if (!codes.length) { appendLog('❌ Tidak ada code valid.', 'error'); return; }

  if (roundTripRunning) { appendLog('⚠️ Round-trip masih berjalan. Tunggu selesai.', 'warning'); return; }

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
  const results = await runExtractLoop(tab, codes, searchDelay, modalDelay);

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
  // Stop juga round-trip yang jalan di background (popup mungkin tertutup saat tab switch).
  chrome.runtime.sendMessage({ type: 'STOP_BG_EXTRACT' }).catch(() => {});
  appendLog('⛔ Stop ekstrak diminta.', 'warning');
  setStatus('stopped');
  extractBtn.disabled = false;
  extractStopBtn.disabled = true;
});

async function runRoundTrip(codes) {
  if (roundTripRunning) { appendLog('⚠️ Round-trip sudah berjalan.', 'warning'); return; }
  roundTripRunning = true;
  extractStopped = false;
  roundTripLinks = [];
  try {
    const tab = await getFasihTab();
    if (!tab) {
      appendLog('❌ Tab FASIH tidak ditemukan untuk round-trip.', 'error');
      return;
    }
    const ok = await ensureContent(tab.id);
    if (!ok) return;

    const searchDelay = parseInt(cfgSearch.value, 10) || 1500;
    const modalDelay = parseInt(cfgModal.value, 10) || 2000;

    setStatus('running');
    extractBtn.disabled = true;
    extractStopBtn.disabled = false;
    progressSection.style.display = '';
    updateProgress(0, codes.length, 'Memulai round-trip...');

    appendLog(`🔁 Round-trip: ekstraksi link untuk ${codes.length} code...`, 'info');

    await runExtractLoop(tab, codes, searchDelay, modalDelay, (res) => {
      if (res && res.status === 'ok' && res.link) roundTripLinks.push(res.link);
    });

    setStatus(extractStopped ? 'stopped' : 'done');
    extractBtn.disabled = false;
    extractStopBtn.disabled = true;

    if (extractStopped) {
      appendLog('⛔ Round-trip dihentikan.', 'warning');
      return;
    }

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
  } finally {
    roundTripRunning = false;
  }
}

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
  } else if (message.type === 'ASSIGN_DUP_CODES') {
    // Background sudah menjalankan loop ekstraksi sendiri (popup mungkin tertutup
    // saat tab switch ke Gemini). Di sini hanya tampilan info.
    const codes = message.codes || [];
    appendLog(`🔁 Gemini indikasi ${codes.length} duplikat. Background sedang ekstraksi link...`, 'info');
  } else if (message.type === 'ASSIGN_DUP_NONE') {
    appendLog('⏱️ Gemini tidak indikasi duplikat dalam 90s. Round-trip selesai.', 'warning');
    setStatus('idle');
  } else if (message.type === 'EXCEL_RUN_DONE') {
    excelResultMap = message.results || [];
    setStatus('done');
    prosesSemuaBtn.disabled = false;
    stopExcelBtn.disabled = true;
    downloadHasilBtn.style.display = '';
    const filled = excelResultMap.filter((r) => r && r.assignment_id_duplicate).length;
    appendLog(`🎉 Proses selesai: ${filled}/${excelResultMap.length} baris punya assignment_id_duplicate. Klik Download Hasil.`, 'success');
  }
});

// ============================================================
// EXCEL UPLOAD + PROSES SEMUA BARIS
// ============================================================
const excelFileEl  = $('excelFile');
const uploadZone   = $('uploadZone');
const fileInfo     = $('fileInfo');
const rowCountEl   = $('rowCount');
const prosesSemuaBtn = $('prosesSemuaBtn');
const stopExcelBtn = $('stopExcelBtn');
const downloadHasilBtn = $('downloadHasilBtn');

let excelRawBase64 = null;
let excelFilename = 'hasil_proses.xlsx';
let excelParsedRows = [];
let excelResultMap = null; // { assignment_id_duplicate, nama_duplicate, catatan } per row index

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function handleExcelFile(file) {
  if (!file.name.match(/\.(xlsx|xls)$/i)) {
    appendLog('Format file harus .xlsx atau .xls', 'error');
    return;
  }
  try {
    const buffer = await file.arrayBuffer();
    excelRawBase64 = arrayBufferToBase64(buffer);
    const wb = XLSX.read(buffer, { type: 'array' });
    const wsName = wb.SheetNames[0];
    const ws = wb.Sheets[wsName];
    excelParsedRows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (!excelParsedRows.length) { appendLog('File Excel kosong!', 'error'); return; }
    excelFilename = file.name.replace(/\.(xlsx|xls)$/i, '') + '_hasil.xlsx';
    rowCountEl.textContent = `✅ ${excelParsedRows.length} baris siap diproses`;
    fileInfo.style.display = '';
    prosesSemuaBtn.disabled = false;
    appendLog(`📄 File ${file.name}: ${excelParsedRows.length} baris dimuat.`, 'success');
  } catch (err) {
    appendLog(`❌ Gagal parse Excel: ${err.message}`, 'error');
  }
}

uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('dragover'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
uploadZone.addEventListener('drop', (e) => {
  e.preventDefault(); uploadZone.classList.remove('dragover');
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) handleExcelFile(f);
});
excelFileEl.addEventListener('change', () => { if (excelFileEl.files[0]) handleExcelFile(excelFileEl.files[0]); });

prosesSemuaBtn.addEventListener('click', async () => {
  if (!excelParsedRows.length) { appendLog('❌ Upload file Excel dulu.', 'error'); return; }
  const missing = ['data1', 'code_identity', 'Batch_Multi-Keyword_(variasin_nama)'];
  const cols = Object.keys(excelParsedRows[0]);
  for (const c of missing) {
    if (!cols.includes(c)) { appendLog(`❌ Kolom "${c}" tidak ditemukan di Excel!`, 'error'); return; }
  }
  setStatus('running');
  prosesSemuaBtn.disabled = true;
  stopExcelBtn.disabled = false;
  downloadHasilBtn.style.display = 'none';
  excelResultMap = null;
  appendLog(`🚀 Proses ${excelParsedRows.length} baris dimulai...`, 'info');
  try {
    await chrome.runtime.sendMessage({
      type: 'START_EXCEL_RUN',
      rows: excelParsedRows.map((r) => ({
        data1: String(r.data1 || ''),
        code_identity: String(r.code_identity || ''),
        'Batch_Multi-Keyword_(variasin_nama)': String(r['Batch_Multi-Keyword_(variasin_nama)'] || ''),
      })),
    });
  } catch (err) {
    appendLog(`❌ Gagal mulai proses: ${err.message}`, 'error');
    setStatus('stopped');
    prosesSemuaBtn.disabled = false;
    stopExcelBtn.disabled = true;
  }
});

stopExcelBtn.addEventListener('click', async () => {
  chrome.runtime.sendMessage({ type: 'STOP_EXCEL_RUN' }).catch(() => {});
  appendLog('⛔ Stop proses Excel diminta.', 'warning');
  setStatus('stopped');
  prosesSemuaBtn.disabled = false;
  stopExcelBtn.disabled = true;
});

downloadHasilBtn.addEventListener('click', () => generateExcelDownload());

function generateExcelDownload() {
  if (!excelRawBase64) { appendLog('❌ Tidak ada file Excel.', 'error'); return; }
  if (!excelResultMap) { appendLog('❌ Belum ada hasil proses.', 'error'); return; }
  try {
    const wb = XLSX.read(excelRawBase64, { type: 'base64', cellStyles: true });
    const wsName = wb.SheetNames[0];
    const ws = wb.Sheets[wsName];
    const range = XLSX.utils.decode_range(ws['!ref']);
    // Cari index kolom hasil dari header row 0.
    const targets = { assignment_id_duplicate: -1, nama_duplicate: -1, catatan: -1 };
    for (let c = range.s.c; c <= range.e.c; c++) {
      const h = ws[XLSX.utils.encode_cell({ r: 0, c: c })];
      const hval = h ? String(h.v).trim() : '';
      if (hval in targets && targets[hval] === -1) targets[hval] = c;
    }
    for (let rowIdx = 0; rowIdx < excelParsedRows.length; rowIdx++) {
      const res = excelResultMap[rowIdx];
      if (!res) continue;
      const excelRow = rowIdx + 1; // header = row 0
      for (const [colName, colIdx] of Object.entries(targets)) {
        if (colIdx === -1) continue;
        const val = res[colName] || '';
        ws[XLSX.utils.encode_cell({ r: excelRow, c: colIdx })] = { t: 's', v: val };
      }
    }
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
    const dataUrl = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${wbout}`;
    if (chrome.downloads && chrome.downloads.download) {
      chrome.downloads.download({ url: dataUrl, filename: excelFilename, saveAs: true }, (id) => {
        if (chrome.runtime.lastError) downloadViaLink(dataUrl, excelFilename);
        else appendLog(`📥 File "${excelFilename}" berhasil didownload.`, 'success');
      });
    } else {
      downloadViaLink(dataUrl, excelFilename);
    }
  } catch (err) {
    appendLog(`❌ Gagal generate Excel: ${err.message}`, 'error');
  }
}

function downloadViaLink(url, filename) {
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  appendLog(`📥 File "${filename}" didownload via browser.`, 'success');
}

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

  // Restore status proses Excel dari background (indikator tidak hilang saat pindah tab).
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_EXCEL_STATUS' });
    if (res && res.running) {
      setStatus('running');
      prosesSemuaBtn.disabled = true;
      stopExcelBtn.disabled = false;
      appendLog(`🔁 Proses masih berjalan (${res.total || '?'} baris). Stop tetap bisa diklik.`, 'info');
    }
  } catch (_) {}

  const tab = await getFasihTab();
  if (!tab) {
    appendLog('ℹ️ Buka tab FASIH (fasih-sm.bps.go.id) untuk mulai.', 'info');
  }
  if (!(document.querySelector('.status-dot.running'))) setStatus('idle');
})();
