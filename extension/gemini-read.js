/**
 * FASIH Quick Copy — gemini-read.js
 * Di-inject (MAIN world) oleh background untuk membaca response Gemini terakhir.
 * Cari pola "assignment_id_duplicate: <code>; <code>" -> return { found, codes, raw }.
 *
 * Format (user): assignment_id_duplicate: 7271030002000300; 7271020008003401
 */
'use strict';

(function () {
  // Kumpulkan teks response Gemini dari container umum, fallback document body.
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
      document.querySelectorAll(s).forEach((e) => candidates.push(e));
    } catch (_) {}
  }

  // Ambil teks gabungan: kandidat terakhir (asumsi chat terbaru di bawah), fallback body.
  let text = '';
  if (candidates.length) {
    text = (candidates[candidates.length - 1].innerText || '').replace(/\s+/g, ' ');
  } else {
    text = (document.body.innerText || '').replace(/\s+/g, ' ');
  }

  // Buang markdown bold (**) — Gemini sering bold label: "**assignment_id_duplicate:**".
  text = text.replace(/\*\*/g, ' ');

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
