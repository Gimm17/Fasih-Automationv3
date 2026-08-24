/**
 * FASIH Quick Copy — gemini-send.js (FINAL)
 *
 * Di-inject di tab Gemini setelah batch selesai.
 * Isi kotak prompt Gemini (Quill contenteditable) lalu kirim (klik tombol send).
 *
 * Selector (diberikan user, 2026-08-24):
 *  - Kotak prompt: div.ql-editor.textarea[contenteditable="true"]
 *      aria-label="Masukkan perintah untuk Gemini"
 *  - Tombol kirim: <button> berisi <mat-icon data-mat-icon-name="arrow_upward">
 */

'use strict';

(async () => {
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (msg, level = 'info') => {
    try { chrome.runtime.sendMessage({ type: 'LOG', message: msg, level }).catch(() => {}); } catch (_) {}
  };

  const stored = await chrome.storage.session.get(['gemini_pending_text', 'gemini_meta']);
  const text = stored.gemini_pending_text || '';
  if (!text || !text.trim()) {
    log('⚠️ Tidak ada teks untuk dikirim ke Gemini.', 'warning');
    return;
  }

  // ============================================================
  // CARI EDITOR (poll, SPA mungkin belum siap)
  // ============================================================
  const findEditor = () =>
    document.querySelector(
      'div.ql-editor.textarea[contenteditable="true"][aria-label="Masukkan perintah untuk Gemini"]'
    ) ||
    document.querySelector('div.ql-editor.textarea[contenteditable="true"]') ||
    document.querySelector('div.ql-editor[contenteditable="true"]');

  let editor = null;
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    editor = findEditor();
    if (editor) break;
    await delay(300);
  }
  if (!editor) {
    log('❌ Kotak prompt Gemini tidak ditemukan.', 'error');
    return;
  }

  // ============================================================
  // ISI EDITOR (Quill contenteditable)
  // ============================================================
  async function fillEditor(ed, content) {
    ed.focus();
    await delay(120);

    // Select-all lalu insertText menggantikan selection.
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(ed);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {}

    let ok = false;
    try { ok = document.execCommand('insertText', false, content); } catch (_) {}

    // Fallback kalau execCommand tidak diterima (secure context / Quill blocker).
    if (!ok || !ed.textContent.trim()) {
      try {
        ed.textContent = content;
        ed.dispatchEvent(new InputEvent('input', {
          bubbles: true, inputType: 'insertText', data: content,
        }));
      } catch (e) {
        log(`❌ Gagal isi editor: ${e.message}`, 'error');
        return false;
      }
    }
    await delay(150);
    return ed.textContent.trim().length > 0;
  }

  const filled = await fillEditor(editor, text);
  if (!filled) {
    log('❌ Teks tidak masuk ke kotak prompt Gemini.', 'error');
    return;
  }
  log(`✅ Teks (${text.length} char) dimasukkan ke kotak prompt.`, 'success');

  // ============================================================
  // KIRIM (klik tombol send = mat-icon arrow_upward)
  // ============================================================
  function findSendButton() {
    const icon = document.querySelector('mat-icon[data-mat-icon-name="arrow_upward"]');
    if (icon) {
      const btn = icon.closest('button') || icon.closest('[role="button"]');
      if (btn) return btn;
    }
    return document.querySelector(
      'button[aria-label*="kirim" i], button[aria-label*="send" i], button[aria-label*="submit" i]'
    );
  }

  // Beri jeda singkat supaya tombol send aktif setelah teks masuk.
  await delay(400);

  let sent = false;
  const btn = findSendButton();
  if (btn) {
    try {
      btn.focus();
      btn.click();
      sent = true;
    } catch (e) {
      log(`⚠️ Klik tombol send error: ${e.message}`, 'warning');
    }
  }

  // Cadangan: Enter pada editor (kalau tombol tidak ketemu).
  if (!sent) {
    try {
      editor.focus();
      editor.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        bubbles: true, cancelable: true,
      }));
      sent = true;
    } catch (e) {
      log(`⚠️ Dispatch Enter error: ${e.message}`, 'warning');
    }
  }

  if (sent) {
    log('✅ Permintaan dikirim ke Gemini ✔', 'success');
    // Bersihkan teks tertunda agar tidak terkirim ulang.
    try { await chrome.storage.session.remove(['gemini_pending_text', 'gemini_meta']); } catch (_) {}
  } else {
    log('❌ Gagal mengirim. Klik tombol send/send manual di Gemini.', 'error');
  }
})();
