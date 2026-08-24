/**
 * FASIH Quick Copy — gemini-read.js
 * Di-inject (MAIN world) oleh background untuk membaca response Gemini terakhir.
 * Cari pola "assignment_id_duplicate: <code>; <code>" -> return { found, codes, raw }.
 *
 * Format (user): assignment_id_duplicate: 7271030002000300; 7271020008003401
 */
'use strict';

(function () {
  // Kumpulkan elemen response Gemini dari selector umum.
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

  // Regex: assignment_id_duplicate: <16 digit>(; <16 digit>)*  (toleransi spasi/newline sekitar ;)
  const re = /assignment_id_duplicate\s*:\s*([0-9]{16}(?:\s*[;,]\s*[0-9]{16})*)/i;

  // Ambil teks satu elemen, strip markdown bold, cocokkan regex.
  const matchIn = (el) => {
    const t = (el.innerText || '').replace(/\s+/g, ' ').replace(/\*\*/g, ' ');
    const mm = t.match(re);
    return mm ? { raw: mm[0], codesStr: mm[1] } : null;
  };

  // Pilih elemen TERKECIL yang mengandung pola = turn terbaru/spesifik, BUKAN wrapper
  // conversation (yang berisi semua turn lama -> bisa re-match assignment_id_duplicate
  // dari jawaban sebelumnya). Urutkan ascending by text length, ambil yang pertama match.
  let match = null;
  if (candidates.length) {
    const withMatch = candidates
      .map((el) => ({ el, hit: matchIn(el) }))
      .filter((x) => x.hit);
    if (withMatch.length) {
      withMatch.sort((a, b) => {
        const la = (a.el.innerText || '').length;
        const lb = (b.el.innerText || '').length;
        return la - lb; // terkecil dulu = paling spesifik (turn tunggal)
      });
      match = withMatch[0].hit;
    }
  }
  // Fallback: document body (kasus selector tidak ketemu sama sekali).
  if (!match) {
    const bodyHit = matchIn(document.body);
    if (bodyHit) match = bodyHit;
  }

  let codes = [];
  if (match && match.codesStr) {
    codes = match.codesStr.split(/[;,]/).map((s) => s.trim()).filter((s) => /^\d{16}$/.test(s));
  }

  // Dedup, urutan pertama muncul.
  const seen = new Set();
  codes = codes.filter((c) => (seen.has(c) ? false : (seen.add(c), true)));

  return { found: codes.length > 0, codes, raw: match ? match.raw : '' };
})();
