// ============================================================
// arabic-font.js — Arabic Font Loading + Text Shaping
// DACUM Lite v3.1
//
// Responsibilities:
//   1. Load Amiri-Regular.ttf from the project folder via fetch
//   2. Register it in jsPDF (addFileToVFS + addFont)
//   3. Apply Arabic shaping (letter connection forms)
//   4. Apply BiDi (right-to-left visual reordering)
//
// Public API:
//   loadArabicFont(pdf)   → async, registers font, returns font name or null
//   getArabicFontName()   → 'Amiri' after successful load, null otherwise
//   ra(text)              → reshape + bidi for use with pdf.text()
// ============================================================

// ── Font state ────────────────────────────────────────────────
let _fontName      = null;   // set after successful registration
let _loadAttempted = false;  // guard: only fetch once per session

// ── 1. Arabic character forms table ──────────────────────────
// Each entry: [isolated, final, initial, medial]
// Covers all Arabic letters in Unicode block 0621–064A
const _AR_FORMS = {
    0x0621: [0xFE80, 0xFE80, 0xFE80, 0xFE80],  // ء
    0x0622: [0xFE81, 0xFE82, 0xFE81, 0xFE82],  // آ
    0x0623: [0xFE83, 0xFE84, 0xFE83, 0xFE84],  // أ
    0x0624: [0xFE85, 0xFE86, 0xFE85, 0xFE86],  // ؤ
    0x0625: [0xFE87, 0xFE88, 0xFE87, 0xFE88],  // إ
    0x0626: [0xFE89, 0xFE8A, 0xFE8B, 0xFE8C],  // ئ
    0x0627: [0xFE8D, 0xFE8E, 0xFE8D, 0xFE8E],  // ا
    0x0628: [0xFE8F, 0xFE90, 0xFE91, 0xFE92],  // ب
    0x0629: [0xFE93, 0xFE94, 0xFE93, 0xFE94],  // ة
    0x062A: [0xFE95, 0xFE96, 0xFE97, 0xFE98],  // ت
    0x062B: [0xFE99, 0xFE9A, 0xFE9B, 0xFE9C],  // ث
    0x062C: [0xFE9D, 0xFE9E, 0xFE9F, 0xFEA0],  // ج
    0x062D: [0xFEA1, 0xFEA2, 0xFEA3, 0xFEA4],  // ح
    0x062E: [0xFEA5, 0xFEA6, 0xFEA7, 0xFEA8],  // خ
    0x062F: [0xFEA9, 0xFEAA, 0xFEA9, 0xFEAA],  // د
    0x0630: [0xFEAB, 0xFEAC, 0xFEAB, 0xFEAC],  // ذ
    0x0631: [0xFEAD, 0xFEAE, 0xFEAD, 0xFEAE],  // ر
    0x0632: [0xFEAF, 0xFEB0, 0xFEAF, 0xFEB0],  // ز
    0x0633: [0xFEB1, 0xFEB2, 0xFEB3, 0xFEB4],  // س
    0x0634: [0xFEB5, 0xFEB6, 0xFEB7, 0xFEB8],  // ش
    0x0635: [0xFEB9, 0xFEBA, 0xFEBB, 0xFEBC],  // ص
    0x0636: [0xFEBD, 0xFEBE, 0xFEBF, 0xFEC0],  // ض
    0x0637: [0xFEC1, 0xFEC2, 0xFEC3, 0xFEC4],  // ط
    0x0638: [0xFEC5, 0xFEC6, 0xFEC7, 0xFEC8],  // ظ
    0x0639: [0xFEC9, 0xFECA, 0xFECB, 0xFECC],  // ع
    0x063A: [0xFECD, 0xFECE, 0xFECF, 0xFED0],  // غ
    0x0641: [0xFED1, 0xFED2, 0xFED3, 0xFED4],  // ف
    0x0642: [0xFED5, 0xFED6, 0xFED7, 0xFED8],  // ق
    0x0643: [0xFED9, 0xFEDA, 0xFEDB, 0xFEDC],  // ك
    0x0644: [0xFEDD, 0xFEDE, 0xFEDF, 0xFEE0],  // ل
    0x0645: [0xFEE1, 0xFEE2, 0xFEE3, 0xFEE4],  // م
    0x0646: [0xFEE5, 0xFEE6, 0xFEE7, 0xFEE8],  // ن
    0x0647: [0xFEE9, 0xFEEA, 0xFEEB, 0xFEEC],  // ه
    0x0648: [0xFEED, 0xFEEE, 0xFEED, 0xFEEE],  // و
    0x0649: [0xFEEF, 0xFEF0, 0xFBE8, 0xFBE9],  // ى
    0x064A: [0xFEF1, 0xFEF2, 0xFEF3, 0xFEF4],  // ي
};

// Letters that do NOT connect to the following letter
const _NO_RIGHT_JOIN = new Set([
    0x0621, 0x0622, 0x0623, 0x0624, 0x0625, // ء آ أ ؤ إ
    0x0627,                                  // ا
    0x062F, 0x0630,                          // د ذ
    0x0631, 0x0632,                          // ر ز
    0x0648,                                  // و
    0x0629,                                  // ة
]);

// Lam-Alef mandatory ligatures: next-char -> isolated ligature codepoint
const _LAM_ALEF = {
    0x0627: 0xFEFB, // لا
    0x0622: 0xFEF5, // لآ
    0x0623: 0xFEF7, // لأ
    0x0625: 0xFEF9, // لإ
};

// ── 2. Internal helpers ───────────────────────────────────────

function _isArabicLetter(cp) {
    return cp >= 0x0621 && cp <= 0x064A;
}

function _isArabicBlock(cp) {
    return (cp >= 0x0600 && cp <= 0x06FF) ||
           (cp >= 0xFE70 && cp <= 0xFEFF) ||
           (cp >= 0xFB50 && cp <= 0xFDFF);
}

function _canJoinLeft(cp) {
    return _isArabicLetter(cp) && !_NO_RIGHT_JOIN.has(cp);
}

// ── 3. Arabic shaping ─────────────────────────────────────────

function _shapeArabic(text) {
    const cps = [...text].map(c => c.codePointAt(0));
    const out = [];
    let i = 0;

    while (i < cps.length) {
        const cp = cps[i];

        if (!_isArabicLetter(cp)) {
            out.push(cp);
            i++;
            continue;
        }

        // Lam-Alef ligature
        if (cp === 0x0644 && i + 1 < cps.length && _LAM_ALEF[cps[i + 1]] !== undefined) {
            const ligBase = _LAM_ALEF[cps[i + 1]];
            const prevJoins = i > 0 && _isArabicLetter(cps[i - 1]) && _canJoinLeft(cps[i - 1]);
            out.push(prevJoins ? ligBase + 1 : ligBase);
            i += 2;
            continue;
        }

        const forms = _AR_FORMS[cp];
        if (!forms) { out.push(cp); i++; continue; }

        const prevCp    = i > 0 ? cps[i - 1] : 0;
        const nextCp    = i < cps.length - 1 ? cps[i + 1] : 0;
        const prevJoins = _isArabicLetter(prevCp) && _canJoinLeft(prevCp);
        const nextJoins = _isArabicLetter(nextCp);

        let formIdx;
        if (prevJoins && nextJoins && _canJoinLeft(cp)) formIdx = 3;      // medial
        else if (prevJoins)                              formIdx = 1;      // final
        else if (nextJoins && _canJoinLeft(cp))          formIdx = 2;      // initial
        else                                             formIdx = 0;      // isolated

        out.push(forms[formIdx]);
        i++;
    }

    return out.map(cp => String.fromCodePoint(cp)).join('');
}

// ── 4. BiDi reordering ────────────────────────────────────────

function _bidi(text) {
    if (!text) return '';

    // Split into Arabic vs non-Arabic runs
    const runs = [];
    let buf = '';
    let bufIsAr = null;

    for (const ch of text) {
        const cp   = ch.codePointAt(0);
        const isAr = _isArabicBlock(cp);

        if (cp === 0x0020) {         // space: attach to current run
            buf += ch;
            continue;
        }

        if (bufIsAr === null) bufIsAr = isAr;

        if (isAr !== bufIsAr) {
            if (buf) runs.push({ t: buf, ar: bufIsAr });
            buf = ch; bufIsAr = isAr;
        } else {
            buf += ch;
        }
    }
    if (buf) runs.push({ t: buf, ar: bufIsAr });

    // RTL base direction: reverse run order; reverse chars within Arabic runs
    runs.reverse();
    return runs.map(r => r.ar ? [...r.t].reverse().join('') : r.t).join('');
}

// ── 5. Public: ra() — reshape + bidi ─────────────────────────

/**
 * Reshape Arabic text and apply BiDi visual reordering.
 * Call this on every Arabic string before pdf.text().
 *
 * @param   {string} text  raw Arabic or mixed Arabic/Latin
 * @returns {string}       visually ordered Presentation Forms string
 */
export function ra(text) {
    if (!text) return '';
    return _bidi(_shapeArabic(text));
}

// ── 6. Font loading ───────────────────────────────────────────

/**
 * Load Amiri-Regular.ttf from the project folder, register it in
 * the provided jsPDF instance, and return the font name.
 *
 * The font file must be placed at:  ./fonts/Amiri-Regular.ttf
 * relative to the HTML entry point (i.e. the GitHub Pages root).
 *
 * @param   {jsPDF} pdf   jsPDF document instance
 * @returns {Promise<string|null>}  font name on success, null on failure
 */
export async function loadArabicFont(pdf) {
    // Return cached result if already attempted this session
    if (_loadAttempted) return _fontName;
    _loadAttempted = true;

    try {
        const response = await fetch('./fonts/Amiri-Regular.ttf');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const buffer    = await response.arrayBuffer();
        const uint8     = new Uint8Array(buffer);

        // Convert to base64 in chunks to avoid call-stack overflow
        let binary = '';
        const CHUNK = 8192;
        for (let i = 0; i < uint8.length; i += CHUNK) {
            binary += String.fromCharCode(...uint8.subarray(i, i + CHUNK));
        }
        const base64 = btoa(binary);

        pdf.addFileToVFS('Amiri-Regular.ttf', base64);
        pdf.addFont('Amiri-Regular.ttf', 'Amiri', 'normal');

        _fontName = 'Amiri';
        console.log('[arabic-font] Amiri-Regular loaded successfully');
        return _fontName;

    } catch (err) {
        console.warn('[arabic-font] Could not load Amiri-Regular.ttf:', err.message);
        console.warn('[arabic-font] Make sure fonts/Amiri-Regular.ttf exists in the project root.');
        return null;
    }
}

/**
 * Return the registered Arabic font name, or null if not yet loaded.
 * @returns {string|null}
 */
export function getArabicFontName() {
    return _fontName;
}
