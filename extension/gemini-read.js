/**
 * FASIH Quick Copy — gemini-read.js (mode-aware)
 * Di-inject (MAIN world) oleh background untuk membaca response Gemini TERBARU.
 *
 * Mode otomatis dari isi respons:
 *   - ROUND-1 (ada label `nama_duplicate:` / `catatan:`):
 *       -> { mode:'round1', namaDuplicate, catatan, codes (query FASIH dari assignment_id_duplicate) }
 *   - ROUND-2 (hanya `assignment_id_duplicate:` tanpa nama/catatan):
 *       -> { mode:'round2', assignmentId (UUID/final), codes }
 *
 * Nilai assignment_id_duplicate bisa berbagai bentuk (tidak dipaksa pola):
 *   "7271011001000200 - UMK - 76"
 *   "7271 - SE26ms2khy63AA"
 *   "7271030002000300; 7271020008003401"
 *   "(Silakan kirimkan tautan assignment 7271011001000200 - UMK - 76 ...)"
 *   UUID mentah: "11c80e95-8ae1-427b-88e9-9f098f7f3790"
 */
'use strict';

(function () {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').replace(/\*\*/g, ' ').trim();

  // --- Label generik: "X: value" sampai label berikutnya / akhir ---
  const fieldRe = (name) => new RegExp(name + '\\s*:\\s*(.*?)(?=\\b(?:assignment_id_duplicate|nama_duplicate|catatan)\\b\\s*:|$)', 'i');

  const assignmentRe = /assignment_id_duplicate\s*:\s*(.*?)(?=\b(?:nama_duplicate|catatan\s*2?)\s*:|$)/i;
  const namaRe       = /nama_duplicate\s*:\s*(.*?)(?=\b(?:assignment_id_duplicate|catatan\s*2?)\s*:|$)/i;
  const catatanRe    = /catatan\s*2?\s*:\s*(.*?)(?=\b(?:assignment_id_duplicate|nama_duplicate)\s*:|$)/i;

  // Dari nilai mentah assignment_id_duplicate, hasilkan array query pencarian FASIH.
  function valueToQueries(rawVal) {
    let v = norm(rawVal);
    if (!v) return [];

    // Case wrapper instruksi: "… assignment <X> …" — ambil bagian setelah "assignment".
    const assignIdx = v.toLowerCase().indexOf('assignment');
    if (assignIdx !== -1) {
      v = v.slice(assignIdx + 'assignment'.length).trim();
      v = v.replace(/^\(+/, '').trim();
      // Potong tepat sebelum kata instruksi umum.
      v = v.replace(/\s+(jika|untuk|yang|agar|supaya|guna|dengan)\b.*$/i, '').trim();
      v = v.replace(/\)+$/, '').trim();
    }

    v = v.replace(/^\(+/, '').replace(/\)+$/, '').trim();
    if (!v) return [];

    return v.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  }

  // Simpel: ambil nilai mentah field, norm.
  function fieldValue(text, re) {
    const m = text.match(re);
    return m ? norm(m[1] || '') : '';
  }

  const readResponse = (el) => {
    const t = norm(el && el.innerText ? el.innerText : '');
    if (!t) return null;

    const nama = fieldValue(t, namaRe);
    const catatan = fieldValue(t, catatanRe);
    const isRound1 = !!(nama || catatan);

    const assignmentRaw = fieldValue(t, assignmentRe);
    const codes = valueToQueries(assignmentRaw);

    if (isRound1) {
      return { mode: 'round1', namaDuplicate: nama, catatan, codes, raw: t.slice(0, 200) };
    }
    return { mode: 'round2', assignmentId: codes[0] || '', codes, raw: t.slice(0, 200) };
  };

  // Pilih response TERBARU: iterasi selector prioritas, ambil elemen terakhir DOM
  // yang punya label assignment_id_duplicate.
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
      const t = norm(nodes[i].innerText || '');
      if (/assignment_id_duplicate/i.test(t)) {
        const hit = readResponse(nodes[i]);
        if (hit && (hit.codes.length || hit.assignmentId || hit.namaDuplicate || hit.catatan)) {
          match = hit; break;
        }
      }
    }
    if (match) break;
  }
  if (!match) {
    const hit = readResponse(document.body);
    if (hit) match = hit;
  }
  if (!match) match = { mode: 'round2', assignmentId: '', codes: [], raw: '' };

  const seen = new Set();
  const codes = (match.codes || []).filter((q) => (seen.has(q) ? false : (seen.add(q), true)));

  const result = {
    found: !!((match.codes && match.codes.length) || match.assignmentId),
    mode: match.mode,
    codes,
    raw: match.raw,
  };
  if (match.mode === 'round1') {
    result.namaDuplicate = match.namaDuplicate;
    result.catatan = match.catatan;
  } else {
    result.assignmentId = match.assignmentId || codes[0] || '';
  }
  return result;
})();
