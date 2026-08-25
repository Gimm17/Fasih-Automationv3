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

  // Regex label: cocokkan "assignment_id_duplicate" + ":" (toleransi bold markdown & spasi).
  const labelRe = /assignment_id_duplicate\s*:*\s*\*?\*?/i;

  // Setelah label, ambil SEMUA angka 16 digit yang muncul pada sisa teks elemen itu.
  // Format Gemini berubah-ubah:
  //   lama: assignment_id_duplicate: 7271030002000300; 7271020008003401
  //   baru: assignment_id_duplicate: (Silakan salin ID dari tautan assignment
  //         <code>7271010011003101 - UMK - 36</code>)
  // Jadi jangan paksa digit langsung setelah ":" — cukup ambil 16-digit pertama
  // PADA elemen yang memuat label assignment_id_duplicate.
  const codeRe = /\b\d{16}\b/g;

  // Ambil teks satu elemen, strip markdown bold, cocokkan label lalu kumpulkan kode.
  const matchIn = (el) => {
    const t = (el.innerText || '').replace(/\s+/g, ' ').replace(/\*\*/g, ' ');
    const lm = t.match(labelRe);
    if (!lm) return null;
    // Ambil semua kode 16 digit di SELURUH teks elemen ini (bukan hanya setelah label),
    // supaya format "(Silakan salin ID ... <code>7271010011003101 - UMK - 36</code>)"
    // tetap terbaca.
    const codes = [];
    let cm;
    codeRe.lastIndex = 0;
    while ((cm = codeRe.exec(t)) !== null) {
      codes.push(cm[0]);
    }
    return { raw: lm[0], codes };
  };

  // Pilih elemen TERKECIL yang mengandung label = turn terbaru/spesifik, BUKAN wrapper
  // conversation (yang berisi semua turn lama -> bisa re-match assignment_id_duplicate
  // dari jawaban sebelumnya). Urutkan ascending by text length, ambil yang pertama match.
  let match = null;
  if (candidates.length) {
    const withMatch = candidates
      .map((el) => ({ el, hit: matchIn(el) }))
      .filter((x) => x.hit && x.hit.codes.length > 0);
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
    if (bodyHit && bodyHit.codes.length > 0) match = bodyHit;
  }

  let codes = [];
  if (match && match.codes) {
    codes = match.codes.filter((s) => /^\d{16}$/.test(s));
  }

  // Dedup, urutan pertama muncul.
  const seen = new Set();
  codes = codes.filter((c) => (seen.has(c) ? false : (seen.add(c), true)));

  return { found: codes.length > 0, codes, raw: match ? match.raw : '' };
})();
