/**
 * FASIH Quick Copy — gemini-read.js
 * Di-inject (MAIN world) oleh background untuk membaca response Gemini TERBARU.
 * Cari label "assignment_id_duplicate:" dan ekstrak kode 16 digit HANYA dari
 * nilai setelah label (sampai label berikutnya: nama_duplicate / catatan),
 * BUKAN seluruh body response (yang memuat kode kandidat lain lebih dulu).
 *
 * Format nilai (berubah-ubah):
 *   lama: assignment_id_duplicate: 7271030002000300; 7271020008003401
 *   baru: assignment_id_duplicate:
 *         (Silakan kirimkan tautan assignment 7271011001000200 - UMK - 76
 *          jika ingin langsung diekstrak UUID-nya)
 */
'use strict';

(function () {
  // Normalisasi: whitespace jadi spasi tunggal, buang markdown bold.
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').replace(/\*\*/g, ' ');

  // Label + nilai: ambil nilai non-greedy sampai label berikutnya (nama_duplicate/ catatan) atau EOL.
  const labelValRe = /assignment_id_duplicate\s*:\s*(.*?)(?=\b(?:nama_duplicate|catatan)\b\s*:|$)/i;
  const codeRe = /\b\d{16}\b/g;

  const readValue = (el) => {
    const t = norm(el && el.innerText ? el.innerText : '');
    if (!t) return null;
    const m = t.match(labelValRe);
    if (!m) return null;
    const val = m[1] || '';
    const codes = [];
    let cm;
    codeRe.lastIndex = 0;
    while ((cm = codeRe.exec(val)) !== null) codes.push(cm[0]);
    return { raw: m[0], codes };
  };

  // Pilih response TERBARU (chat terbaru ada di bawah): iterasi selector prioritas,
  // untuk tiap selector ambil elemen TERAKHIR di DOM yang punya label + kode.
  const selectorGroups = [
    'model-response',
    '[class*="message-content"]',
    'structured-content-container',
    '[class*="response-container"]',
  ];
  let match = null;
  for (const sel of selectorGroups) {
    let nodes = [];
    try { nodes = Array.from(document.querySelectorAll(sel)); } catch (_) {}
    for (let i = nodes.length - 1; i >= 0; i--) {
      const hit = readValue(nodes[i]);
      if (hit && hit.codes.length > 0) { match = hit; break; }
    }
    if (match) break;
  }
  // Fallback: seluruh body (kalau selector respons tidak ketemu).
  if (!match) {
    const bodyHit = readValue(document.body);
    if (bodyHit && bodyHit.codes.length > 0) match = bodyHit;
  }

  const seen = new Set();
  const codes = (match ? match.codes : []).filter(
    (c) => (seen.has(c) ? false : (seen.add(c), true))
  );

  return { found: codes.length > 0, codes, raw: match ? match.raw : '' };
})();
