/**
 * FASIH Quick Copy — background.js v3
 * Service worker: router pesan + kirim hasil batch ke Gemini (MAIN world).
 */

'use strict';

function badge(text, color) {
  try {
    chrome.action.setBadgeBackgroundColor({ color });
    chrome.action.setBadgeText({ text });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 5000);
  } catch (_) {}
}

function logPopup(msg, level = 'info') {
  try { chrome.runtime.sendMessage({ type: 'LOG', message: msg, level }).catch(() => {}); } catch (_) {}
}

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'BATCH_DONE') {
    sendToGemini(message.text || '', message);
  }
  if (message && message.type === 'EXTRACT_DONE') {
    sendToGemini(message.text || '', { source: 'extract' });
  }
  return false;
});

// ============================================================
// MAIN-WORLD FILL+SEND (dipanggil via executeScript { world:'MAIN' })
// Harus self-contained: tidak boleh referensi outer scope kecuali via args.
// ============================================================
function FASIH_FILL_GEMINI(text) {
  return new Promise((resolve) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      try {
        window.focus();
        await wait(120);

        // Gemini punya BEBERAPA .ql-editor (mis. di sidebar bard-sidenav-content).
        // Pilih yang TERLIHAT & rect TERBESAR = kotak prompt utama.
        // Selector ketat dulu, lalu fallback longgar tapi tetap pakai heuristik rect.
        const pickEditor = () => {
          const all = Array.from(document.querySelectorAll(
            'div.ql-editor[contenteditable="true"]'
          )).filter((e) => {
            const r = e.getBoundingClientRect();
            const st = window.getComputedStyle(e);
            // skip elemen 0x0 / display:none / visibility:hidden / disembunyikan aria.
            return (r.width > 40 && r.height > 20) &&
                   st.display !== 'none' && st.visibility !== 'hidden' &&
                   e.offsetParent !== null;
          });
          if (!all.length) return null;
          // Prefer yang ber-aria-label persis, kalau ada & terlihat.
          const exact = all.find((e) => (e.getAttribute('aria-label') || '').includes('Masukkan perintah'));
          if (exact) return exact;
          // Kalau tidak, ambil yang rect terbesar (kotak prompt jauh lebih besar dari sidebar).
          return all.sort((a, b) => {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            return (rb.width * rb.height) - (ra.width * ra.height);
          })[0];
        };

        let editor = null;
        for (let i = 0; i < 40; i++) { editor = pickEditor(); if (editor) break; await wait(200); }
        if (!editor) return resolve({ ok: false, error: 'editor not found' });

        // Focus dengan retry (tab baru aktif programatik -> dokumen belum fokus).
        for (let i = 0; i < 5; i++) {
          try { window.focus(); } catch (_) {}
          editor.focus({ preventScroll: true });
          await wait(100);
          if (document.hasFocus && document.hasFocus()) break;
        }

        // 1. Quill API (paling andal -> tombol send ikut aktif).
        let quill = editor.__quill;
        if (!quill && window.Quill && window.Quill.find) {
          try { quill = window.Quill.find(editor); } catch (_) {}
        }
        let filled = false;
        if (quill) {
          try {
            if (typeof quill.setText === 'function') { quill.setText(text); filled = true; }
            else if (typeof quill.insertText === 'function') {
              try { quill.setContents([]); } catch (_) {}
              quill.insertText(0, text); filled = true;
            }
          } catch (e) { filled = false; }
        }

        // 2. execCommand insertText (butuh fokus + selection di editor yang BENAR).
        if (!filled) {
          try {
            editor.focus({ preventScroll: true });
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(editor);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
            let ok = false;
            try { ok = document.execCommand('insertText', false, text); } catch (_) {}
            filled = ok && editor.textContent.trim().length > 0;
          } catch (_) {}
        }

        // 3. Last resort: DOM langsung + input event.
        if (!filled) {
          editor.textContent = text;
          editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
          filled = editor.textContent.trim().length > 0;
        }

        if (!filled) return resolve({ ok: false, error: 'fill failed' });
        await wait(450);

        // KIRIM: tombol send = mat-icon arrow_upward.
        const icon = document.querySelector('mat-icon[data-mat-icon-name="arrow_upward"]');
        let btn = null;
        if (icon) btn = icon.closest('button') || icon.closest('[role="button"]');
        if (!btn) btn = document.querySelector('button[aria-label*="kirim" i], button[aria-label*="send" i], button[aria-label*="submit" i]');

        let sent = false;
        if (btn && !btn.disabled) {
          try { btn.click(); sent = true; } catch (_) {}
        }
        if (!sent) {
          // Cadangan: Enter di editor.
          try {
            editor.focus({ preventScroll: true });
            editor.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
            }));
            sent = true;
          } catch (_) {}
        }
        resolve({ ok: true, sent, hasButton: !!btn, btnDisabled: btn ? !!btn.disabled : null });
      } catch (e) {
        resolve({ ok: false, error: String(e && e.message || e) });
      }
    })();
  });
}

// ============================================================
// KIRIM KE GEMINI
// ============================================================
async function sendToGemini(text, meta) {
  if (!text || !text.trim()) {
    logPopup('⚠️ Tidak ada hasil untuk dikirim ke Gemini.', 'warning');
    badge('∅', '#f59e0b');
    return;
  }

  const tabs = await chrome.tabs.query({ url: '*://gemini.google.com/*' });
  if (!tabs.length) {
    logPopup('❌ Tab Gemini tidak ditemukan. Buka gemini.google.com dulu.', 'error');
    chrome.runtime.sendMessage({ type: 'GEMINI_TAB_NOT_FOUND' }).catch(() => {});
    badge('✖', '#d93025');
    return;
  }
  const tab = tabs[0];

  try {
    await chrome.tabs.update(tab.id, { active: true });
    logPopup('➡️ Pindah ke tab Gemini, menyiapkan kirim...', 'info');

    // Jeda agar tab benar-benar fokus sebelum inject MAIN-world.
    await new Promise((r) => setTimeout(r, 800));

    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: FASIH_FILL_GEMINI,
      args: [text],
    });

    const r = res && res.result;
    if (r && r.ok && r.sent) {
      logPopup(`✅ Terkirim ke Gemini ✔${r.hasButton ? '' : ' (via Enter)'}`, 'success');
      badge('✓', '#22c55e');
      // Mulai round-trip: poll response Gemini untuk assignment_id_duplicate.
      // Hanya round-1 (meta.source !== 'extract'); round-2 tidak poll lagi (hindari loop).
      if (!meta || meta.source !== 'extract') {
        pollGeminiResponse(tab.id).catch((e) => logPopup(`⚠️ Poll error: ${e.message}`, 'warning'));
      }
    } else if (r && r.ok && !r.sent) {
      logPopup('⚠️ Teks masuk tapi gagal kirim. Klik send manual.', 'warning');
      badge('½', '#f59e0b');
    } else {
      logPopup(`❌ Gagal: ${r && r.error ? r.error : 'tidak diketahui'}`, 'error');
      badge('✖', '#d93025');
    }
  } catch (err) {
    logPopup(`❌ Inject Gemini gagal: ${err.message}`, 'error');
    badge('✖', '#d93025');
  }
}

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
  }

  logPopup('⏱️ Tidak ada assignment_id_duplicate terdeteksi dalam 90 detik. Selesai.', 'warning');
  chrome.runtime.sendMessage({ type: 'ASSIGN_DUP_NONE' }).catch(() => {});
}
