// ============================================================
// fileEngine.js — Professional File Engine v1.0
//
// Handles versioned export and import of DACUM project records.
//
// Design principles:
//   • Zero imports at load time — all dependencies are injected
//     via initFileEngine() to mirror the callback-injection
//     pattern used by storage.js (setSaveHook) and renderer.js
//     (setRendererActions). This keeps the module decoupled and
//     independently testable.
//   • All public functions are wrapped in try/catch so a bad
//     file never crashes the running app.
//   • Schema validation is strict but forward-extensible: a
//     version-dispatch table inside validateImportSchema() is
//     all that is needed to handle future schema changes without
//     touching any other code.
//
// File format (v1.0.0):
//   {
//     app:           "DACUM Professional Tool",
//     version:       "1.0.0",
//     schemaVersion: "1.0.0",
//     exportedAt:    <ISO 8601 timestamp>,
//     project:       { ...full ProjectRecord }
//   }
// ============================================================

// ── Schema identity constants ─────────────────────────────────
const APP_NAME       = 'DACUM Professional Tool';
const VERSION        = '1.0.0';
const SCHEMA_VERSION = '1.0.0';

// ══════════════════════════════════════════════════════════════
//  DEPENDENCY INJECTION
//  Called once during app bootstrap in app.js.
//  Keeps this module decoupled from project-manager.js and
//  app.js at import time — no circular dependency risk.
// ══════════════════════════════════════════════════════════════

/**
 * @typedef {Object} FileEngineCallbacks
 * @property {function(string): (Object|undefined)} getProject
 *   Look up one project record by id. Returns undefined if missing.
 * @property {function(): Object[]} getAllProjects
 *   Return all project records as an array.
 * @property {function(Object): boolean} injectProject
 *   Insert a fully-formed ProjectRecord directly into the store.
 *   Must NOT switch the active project — that is app.js's job.
 * @property {function(): void} persistProjects
 *   Flush the in-memory project store to localStorage.
 * @property {function(Object): void} onImportSuccess
 *   Called after a successful import with the imported project
 *   record. Used by app.js to switch context and refresh UI.
 */

/** @type {FileEngineCallbacks} */
let _cb = {
    getProject:      null,
    getAllProjects:   null,
    injectProject:   null,
    persistProjects: null,
    onImportSuccess: null,
};

/**
 * Wire the external callbacks before calling exportProject or
 * importProject. Called once at module level in app.js.
 *
 * @param {Partial<FileEngineCallbacks>} callbacks
 */
export function initFileEngine(callbacks) {
    _cb = { ..._cb, ...callbacks };
}

// ══════════════════════════════════════════════════════════════
//  PART 1 — EXPORT ENGINE
// ══════════════════════════════════════════════════════════════

/**
 * Serialise a project record into a versioned JSON envelope and
 * trigger a safe browser download.
 *
 * The envelope is self-describing: any future importer can read
 * app, version, and schemaVersion to decide whether to accept,
 * migrate, or reject the payload before touching any state.
 *
 * @param {string} projectId — id of the project to export
 */
export function exportProject(projectId) {
    try {
        // ── Validate: project must exist ───────────────────────
        const project = _cb.getProject(projectId);
        if (!project) {
            throw new Error(`Project not found: "${projectId}"`);
        }

        // ── Build the versioned envelope ───────────────────────
        const envelope = {
            app:           APP_NAME,
            version:       VERSION,
            schemaVersion: SCHEMA_VERSION,
            exportedAt:    new Date().toISOString(),
            project:       _deepClone(project),  // never mutate the live store record
        };

        // ── Serialise (2-space indent for human readability) ───
        const json = JSON.stringify(envelope, null, 2);

        // ── Trigger a safe browser download ───────────────────
        const blob     = new Blob([json], { type: 'application/json' });
        const url      = URL.createObjectURL(blob);
        const fileName = _toFileName(project.name) + '_dacum.json';

        _download(url, fileName);
        URL.revokeObjectURL(url);  // release memory immediately after the click

    } catch (err) {
        console.error('[FileEngine] exportProject failed:', err);
        alert('Export failed:\n\n' + err.message);
    }
}

// ── Private: download trigger ────────────────────────────────

/**
 * Programmatically click a temporary <a> element to start a
 * download. The element is inserted, clicked, and removed
 * synchronously — no lasting DOM side-effects.
 *
 * @param {string} url  — Object URL created by URL.createObjectURL()
 * @param {string} name — Suggested file name for the download
 */
function _download(url, name) {
    const a    = document.createElement('a');
    a.href     = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

/**
 * Convert a project name into a safe, cross-platform file-name
 * segment. Strips characters illegal on Windows and macOS,
 * collapses whitespace, and caps total length.
 *
 * @param {string} name
 * @returns {string}
 */
function _toFileName(name) {
    return (name || 'project')
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')  // strip OS-illegal chars
        .trim()
        .replace(/\s+/g, '_')                    // spaces → underscores
        .slice(0, 60)                            // 60-char cap
        || 'project';
}

// ══════════════════════════════════════════════════════════════
//  PART 2 — IMPORT ENGINE
// ══════════════════════════════════════════════════════════════

/**
 * Import a project from a user-selected .json File object.
 * Reads the file asynchronously so the UI stays responsive.
 *
 * Processing pipeline (runs inside the FileReader callback):
 *   1. Parse JSON safely — throw clear error on bad syntax
 *   2. Validate schema via validateImportSchema()
 *   3. Abort cleanly (alert + return) if validation fails
 *   4. Duplicate-ID protection — assign new ID + rename
 *   5. Normalise any missing optional fields
 *   6. Insert record into store via injectProject()
 *   7. Persist to localStorage via persistProjects()
 *   8. Notify app.js via onImportSuccess() to refresh UI
 *
 * @param {File} file — from an <input type="file"> change event
 */
export function importProject(file) {
    if (!file) return;

    const reader = new FileReader();

    // Disk / permission failure — surface a clean alert, log the error
    reader.onerror = () => {
        console.error('[FileEngine] FileReader could not read:', file.name);
        alert('Could not read the selected file.\nPlease check the file and try again.');
    };

    reader.onload = (e) => {
        try {
            // ── Step 1 & 2: Parse ─────────────────────────────
            let data;
            try {
                data = JSON.parse(e.target.result);
            } catch (parseErr) {
                throw new Error(
                    'The selected file is not valid JSON.\n' +
                    'It may be corrupted or in the wrong format.'
                );
            }

            // ── Step 3: Schema validation ─────────────────────
            const validation = validateImportSchema(data);
            if (!validation.valid) {
                // Alert + abort — no partial state changes
                alert(
                    'Import failed — this is not a valid DACUM project file.\n\n' +
                    'Reason: ' + validation.error
                );
                return;
            }

            // ── Step 4: Duplicate ID protection ───────────────
            // Deep-clone before mutating so the original parsed
            // object is left untouched (helps future debugging).
            let project = _deepClone(data.project);

            const existingIds = (_cb.getAllProjects() || []).map(p => p.id);
            if (existingIds.includes(project.id)) {
                const originalId = project.id;
                project.id   = _generateId();
                project.name = project.name + ' (Imported)';
                console.info(
                    `[FileEngine] Duplicate ID "${originalId}" resolved → ` +
                    `new id "${project.id}", name "${project.name}"`
                );
            }

            // ── Step 5: Normalise optional fields ─────────────
            // Guards against files from future schema versions
            // that add or omit optional keys.
            project.createdAt           = project.createdAt           || new Date().toISOString();
            project.updatedAt           = new Date().toISOString();       // always refresh on import
            project.snapshots           = Array.isArray(project.snapshots) ? project.snapshots : [];
            project.state               = project.state               || {};
            project.state.duties        = project.state.duties        || [];
            project.state.taskCounts    = project.state.taskCounts    || {};
            project.state.dutyCount     = project.state.dutyCount     || 0;
            project.state.isCardView    = false;                          // always open in table view

            // ── Step 6: Insert into project store ─────────────
            _cb.injectProject(project);

            // ── Step 7: Persist to localStorage ───────────────
            _cb.persistProjects();

            // ── Step 8: Notify app.js ─────────────────────────
            // onImportSuccess switches the active project and
            // re-renders the sidebar + status banner.
            if (_cb.onImportSuccess) {
                _cb.onImportSuccess(project);
            }

        } catch (err) {
            console.error('[FileEngine] importProject failed:', err);
            alert('Import failed:\n\n' + err.message);
        }
    };

    reader.readAsText(file);
}

// ── Private: project ID generator ────────────────────────────

/**
 * Generate a unique project ID using the same algorithm as
 * project-manager.js so IDs are format-consistent.
 *
 * @returns {string}
 */
function _generateId() {
    return 'proj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

// ── Private: deep clone ───────────────────────────────────────

/**
 * Return a deep-cloned copy of any JSON-serialisable value.
 * Isolates the live store record from export envelope / import
 * buffer mutations.
 *
 * @template T
 * @param {T} obj
 * @returns {T}
 */
function _deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

// ══════════════════════════════════════════════════════════════
//  PART 3 — SCHEMA VALIDATION (internal, not exported)
//
//  Fails fast: the first broken rule returns a specific,
//  actionable error string so users know exactly what is wrong.
//
//  Forward-upgrade path:
//    Add a version-dispatch block before the field checks:
//      if (data.schemaVersion === '2.0.0') return _validateV2(data);
//    Everything else in this codebase remains untouched.
// ══════════════════════════════════════════════════════════════

/**
 * Validate a parsed import value against the DACUM v1.0.0
 * schema. Returns a result object — never throws.
 *
 * @param {*} data — the value returned by JSON.parse()
 * @returns {{ valid: true } | { valid: false, error: string }}
 */
function validateImportSchema(data) {

    // ── Root type check ───────────────────────────────────────
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return {
            valid: false,
            error: 'File root must be a JSON object, not an array or primitive.'
        };
    }

    // ── App identifier ────────────────────────────────────────
    // Prevents importing files exported by unrelated tools.
    if (data.app !== APP_NAME) {
        return {
            valid: false,
            error:
                `Unrecognised application identifier.\n` +
                `Expected: "${APP_NAME}"\n` +
                `Received: "${data.app}"`
        };
    }

    // ── Version ───────────────────────────────────────────────
    if (!data.version || typeof data.version !== 'string') {
        return {
            valid: false,
            error: '"version" field is missing or is not a string.'
        };
    }

    // ── Schema version ────────────────────────────────────────
    if (!data.schemaVersion || typeof data.schemaVersion !== 'string') {
        return {
            valid: false,
            error: '"schemaVersion" field is missing or is not a string.'
        };
    }

    // ── Project envelope ──────────────────────────────────────
    if (!data.project || typeof data.project !== 'object' || Array.isArray(data.project)) {
        return {
            valid: false,
            error: '"project" field is missing or is not an object.'
        };
    }

    const p = data.project;

    // ── Project id ────────────────────────────────────────────
    if (!p.id || typeof p.id !== 'string' || !p.id.trim()) {
        return {
            valid: false,
            error: 'Project record is missing a valid "id" string.'
        };
    }

    // ── Project name ──────────────────────────────────────────
    if (!p.name || typeof p.name !== 'string' || !p.name.trim()) {
        return {
            valid: false,
            error: 'Project record is missing a valid "name" string.'
        };
    }

    // ── State object ──────────────────────────────────────────
    if (!p.state || typeof p.state !== 'object' || Array.isArray(p.state)) {
        return {
            valid: false,
            error: 'Project record is missing a valid "state" object.'
        };
    }

    // ── Duties array ──────────────────────────────────────────
    if (!Array.isArray(p.state.duties)) {
        return {
            valid: false,
            error: 'Project state is missing the required "duties" array.'
        };
    }

    return { valid: true };
}
