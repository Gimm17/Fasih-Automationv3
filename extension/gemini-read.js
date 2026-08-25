/**
 * FASIH Quick Copy — gemini-read.js
 * Di-inject (MAIN world) oleh background untuk membaca response Gemini TERBARU.
 * Cari label "assignment_id_duplicate:" lalu ambil NILAI-nya utuh sebagai query
 * pencarian FASIH. Nilai tidak dipaksa pola 16-digit — bisa berupa:
 *   "7271011001000200 - UMK - 76"
 *   "7271 - SE26ms2khy63AA"
 *   "7271030002000300; 7271020008003401"
 *   "(Silakan kirimkan tautan assignment 7271011001000200 - UMK - 76 ...)"
 *   "(Silakan salin ID dari tautan assignment 7271010011003101 - UMK - 36)"
 *
 * Aturan bersih-bersih:
 *   - Ambil teks antara label dan label berikutnya (nama_duplicate/ catatan).
 *   - Kalau nilai memuat "... assignment <X>", ambil <X> (bagian setelah "assignment")
 *     sebagai query (buang wrapper instruksi dalam kurung).
 *   - Kalau tidak ada kata "assignment", pakai seluruh nilai (case nilai langsung).
 *   - Multiple (dipisah ;) dipecah jadi item terpisah.
 */
'use strict';

(function () {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').replace(/\*\*/g, ' ').trim();

  // Label + nilai sampai label berikutnya.
  const labelValRe = /assignment_id_duplicate\s*:\s*(.*?)(?=\b(?:nama_duplicate|catatan)\b\s*:|$)/i;

  // Dari nilai mentah, hasilkan array query pencarian FASIH.
  function valueToQueries(rawVal) {
    let v = norm(rawVal);
    if (!v) return [];

    // Case wrapper instruksi: "… assignment <KODE> …" — ambil bagian setelah "assignment".
    const assignIdx = v.toLowerCase().indexOf('assignment');
    if (assignIdx !== -1) {
      v = v.slice(assignIdx + 'assignment'.length).trim();
      // Buang wrapper kurung di awal (jika ada).
      v = v.replace(/^\(+/, '').trim();
      // Potong tepat sebelum kata instruksi yang umum dipakai Gemini setelah kode:
      // "jika", "untuk", "yang", "agar", "supaya", "guna", "dengan".
      v = v.replace(/\s+(jika|untuk|yang|agar|supaya|guna|dengan)\b.*$/i, '').trim();
      // Buang sisa penutup kurung.
      v = v.replace(/\)+$/, '').trim();
    }

    // Bersihkan sisa wrapper kurung di awal/akhir.
    v = v.replace(/^\(+/, '').replace(/\)+$/, '').trim();
    if (!v) return [];

    // Multiple value: pisah dengan ; atau , (nilai contoh lama "code; code").
    return v
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const readValue = (el) => {
    const t = norm(el && el.innerText ? el.innerText : '');
    if (!t) return null;
    const m = t.match(labelValRe);
    if (!m) return null;
    return { raw: m[0], queries: valueToQueries(m[1] || '') };
  };

  // Pilih response TERBARU: iterasi selector prioritas, ambil elemen terakhir
  // di DOM per selector yang punya label + query non-kosong.
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
      if (hit && hit.queries.length > 0) { match = hit; break; }
    }
    if (match) break;
  }
  if (!match) {
    const bodyHit = readValue(document.body);
    if (bodyHit && bodyHit.queries.length > 0) match = bodyHit;
  }

  const seen = new Set();
  const queries = (match ? match.queries : []).filter(
    (q) => (seen.has(q) ? false : (seen.add(q), true))
  );

  // "codes" dipertahankan sebagai nama field agar background/ popup tidak perlu diubah;
  // isinya kini query pencarian FASIH utuh (mis. "7271011001000200 - UMK - 76").
  return { found: queries.length > 0, codes: queries, raw: match ? match.raw : '' };
})();
