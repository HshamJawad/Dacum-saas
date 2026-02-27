// ============================================================
// app.js — Application Bootstrap
// Connects all modules, initialises project manager, renders
// the sidebar, and bootstraps the app on DOMContentLoaded.
// ============================================================
import { AppState, StateManager, applyProjectState, extractProjectState } from './state.js';
import { showStatus }                                                       from './design-system.js';
import {
    undo, redo, updateHistoryButtons, setHistoryRender,
    promptSnapshot, toggleSnapshotPanel, restoreSnapshot,
    SnapshotManager, refreshSnapshotList, escapeHtml
} from './history.js';
import { saveToLocalStorage, setSaveHook }   from './storage.js';
import { initFileEngine }                    from './fileEngine.js';
import { Renderer, setRendererActions }      from './renderer.js';
import {
    EventBinder,
    addDuty, removeDuty, addTask, removeTask,
    clearDuty, cvAddDuty, clearAll, toggleCardView,
    handleImageUpload, removeImage,
    toggleInfoBox, toggleEditHeading, clearSection,
    addCustomSection, removeCustomSection,
    saveToJSON, loadFromJSON,
    exportToWord, exportToPDF,
    exportProjectFile, importProjectFile
} from './events.js';
import {
    createProject, deleteProject, renameProject,
    setActiveProject, getActiveProject, getAllProjects,
    persistProjects, loadProjects,
    updateActiveProjectData, injectProject
} from './project-manager.js';

// ── Wire cross-module render reference ────────────────────────
setHistoryRender(state => Renderer.renderAll(state));

// ── Wire action callbacks into Renderer ───────────────────────
setRendererActions({ addDuty, removeDuty, addTask, removeTask, clearDuty });

// ── Wire StateManager callbacks ───────────────────────────────
StateManager.configure({
    save:   saveToLocalStorage,
    render: state => Renderer.renderAll(state)
});

// ── Wire save hook ─────────────────────────────────────────────
// Every call to saveToLocalStorage() (from history, events, etc.)
// ends up here: sync live state → active project record → disk.
setSaveHook(() => {
    updateActiveProjectData({
        state:     extractProjectState(),
        snapshots: JSON.parse(JSON.stringify(SnapshotManager.snapshots))
    });
    persistProjects();
});

// ── Wire file engine ───────────────────────────────────────────
// initFileEngine is called at module level (not inside
// DOMContentLoaded) because _switchToProject and renderSidebar
// are function declarations and are therefore hoisted — they are
// safely referenceable here before DOMContentLoaded fires.
initFileEngine({
    // Look up one project record by id
    getProject:      (id) => getAllProjects().find(p => p.id === id),

    // Return all project records
    getAllProjects:   getAllProjects,

    // Insert a fully-formed record into the project store
    injectProject:   injectProject,

    // Flush in-memory store to localStorage
    persistProjects: persistProjects,

    // After a successful import: switch context + refresh sidebar
    onImportSuccess: (project) => {
        _switchToProject(project.id);
        showStatus('Project "' + escapeHtml(project.name) + '" imported ✓', 'success');
    },
});

// ══════════════════════════════════════════════════════════════
//  SIDEBAR — internal helpers
// ══════════════════════════════════════════════════════════════

let _sidebarOpen   = true;
let _sidebarFilter = '';

/** Format a date as a human-readable relative string */
function _relDate(isoString) {
    const diff = Date.now() - new Date(isoString).getTime();
    const m    = Math.floor(diff / 60000);
    if (m < 1)  return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    const d = Math.floor(h / 24);
    if (d < 7)  return d + 'd ago';
    return new Date(isoString).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Save current project data before switching away */
function _saveCurrentProject() {
    updateActiveProjectData({
        state:     extractProjectState(),
        snapshots: JSON.parse(JSON.stringify(SnapshotManager.snapshots))
    });
}

/** Load a project record into all live objects and re-render */
function _loadProjectIntoUI(proj) {
    if (!proj) return;

    // 1. Apply stored state to AppState (mutates in-place)
    const hasData = proj.state && Array.isArray(proj.state.duties) && proj.state.duties.length > 0;
    applyProjectState(hasData ? proj.state : { duties: [], taskCounts: {}, dutyCount: 0, isCardView: false });

    // 2. Seed a blank duty when the project is genuinely empty
    if (AppState.duties.length === 0) {
        AppState.dutyCount++;
        const dutyId = 'duty_' + AppState.dutyCount;
        AppState.taskCounts[dutyId] = 1;
        AppState.duties.push({ id: dutyId, title: '', tasks: [{ id: 'task_' + dutyId + '_1', text: '' }] });
    }

    // 3. Restore per-project snapshots
    SnapshotManager.snapshots = JSON.parse(JSON.stringify(proj.snapshots || []));

    // 4. Clear undo/redo — command closures cannot be serialised
    StateManager.undoStack = [];
    StateManager.redoStack = [];

    // 5. Reset UI chrome: card view → table view, reactivate Chart Info tab
    const cardContainer = document.getElementById('cardViewContainer');
    const tabs          = document.querySelector('.tabs');
    const tabContents   = document.querySelectorAll('.tab-content');
    if (cardContainer) cardContainer.style.display = 'none';
    if (tabs)          tabs.style.display          = '';
    tabContents.forEach(tc => { tc.style.display = ''; tc.classList.remove('active'); });
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    const infoTabBtn = document.querySelector('[data-tab="info-tab"]');
    const infoTabEl  = document.getElementById('info-tab');
    if (infoTabBtn) infoTabBtn.classList.add('active');
    if (infoTabEl)  infoTabEl.classList.add('active');

    // 6. Re-render everything
    updateHistoryButtons();
    Renderer.renderAll(StateManager.state);
    refreshSnapshotList();
}

// ── Project switching (public, exposed to window) ─────────────
function _switchToProject(id) {
    const currentId = getActiveProject()?.id;

    // Save current project state before leaving it
    if (currentId) _saveCurrentProject();

    setActiveProject(id);
    persistProjects();

    const proj = getActiveProject();
    _loadProjectIntoUI(proj);
    renderSidebar();

    if (currentId !== id) showStatus('Switched to "' + escapeHtml(proj.name) + '" ✓', 'success');
}

// ── Sidebar open/close ─────────────────────────────────────────
function _setSidebarState(open) {
    _sidebarOpen = open;
    const sidebar    = document.getElementById('sidebar');
    const toggleBtn  = document.getElementById('sidebarToggleBtn');
    const toggleIcon = document.getElementById('sidebarToggleIcon');
    const body       = document.body;

    if (open) {
        sidebar?.classList.remove('sb-collapsed');
        toggleBtn?.classList.remove('sb-collapsed');
        body.classList.remove('sb-sidebar-closed');
        if (toggleIcon) toggleIcon.textContent = '◀';
    } else {
        sidebar?.classList.add('sb-collapsed');
        toggleBtn?.classList.add('sb-collapsed');
        body.classList.add('sb-sidebar-closed');
        if (toggleIcon) toggleIcon.textContent = '▶';
    }
}

// ══════════════════════════════════════════════════════════════
//  SIDEBAR RENDER
// ══════════════════════════════════════════════════════════════
export function renderSidebar(filterText) {
    if (filterText !== undefined) _sidebarFilter = filterText;

    const list    = document.getElementById('sidebarProjectList');
    const countEl = document.getElementById('sbProjectCount');
    if (!list) return;

    const all      = getAllProjects();
    const active   = getActiveProject();
    const filter   = _sidebarFilter.toLowerCase().trim();

    // Update footer count
    if (countEl) {
        countEl.textContent = all.length + ' project' + (all.length !== 1 ? 's' : '');
    }

    // Filter + sort newest-updated first
    const visible = all
        .filter(p => !filter || p.name.toLowerCase().includes(filter))
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    if (visible.length === 0) {
        list.innerHTML = '<div class="sb-empty">No projects found</div>';
        return;
    }

    list.innerHTML = '';
    visible.forEach(proj => {
        const isActive   = proj.id === active?.id;
        const dutyCount  = proj.state?.duties?.length || 0;
        const dateStr    = _relDate(proj.updatedAt);

        const card = document.createElement('div');
        card.className   = 'sb-project-card' + (isActive ? ' sb-active' : '');
        card.dataset.pid = proj.id;

        card.innerHTML = `
            <div class="sb-card-body">
                <div class="sb-card-name" title="${escapeHtml(proj.name)}">${escapeHtml(proj.name)}</div>
                <div class="sb-card-meta">
                    <span class="sb-meta-item">🕐 ${dateStr}</span>
                    <span class="sb-meta-item">📋 ${dutyCount} ${dutyCount === 1 ? 'duty' : 'duties'}</span>
                </div>
            </div>
            <div class="sb-card-actions">
                <button class="sb-delete-btn" title="Delete project"
                        onclick="event.stopPropagation(); pmDeleteProject('${proj.id}')">×</button>
            </div>`;

        // Switch on card-body click (not delete button)
        card.querySelector('.sb-card-body').addEventListener('click', () => _switchToProject(proj.id));
        list.appendChild(card);
    });
}

// ══════════════════════════════════════════════════════════════
//  DOMContentLoaded
// ══════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {

    // ── 1. Load project store ──────────────────────────────────
    loadProjects();

    // ── 2. Apply active project to live state ──────────────────
    _loadProjectIntoUI(getActiveProject());

    // ── 3. Save initial state to project record ────────────────
    //       (seeds the project if it was brand new / migrated)
    updateActiveProjectData({
        state:     extractProjectState(),
        snapshots: JSON.parse(JSON.stringify(SnapshotManager.snapshots))
    });
    persistProjects();

    // ── 4. Bind events and render UI ───────────────────────────
    EventBinder.init();
    renderSidebar();
    _setSidebarState(true);

    // ── 5. Expose all functions to window ──────────────────────
    //       Inline onclick="..." attributes in the HTML need globals.
    Object.assign(window, {
        // ── Duty / Task ──────────────────────────────────────────
        addDuty, removeDuty, addTask, removeTask, clearDuty, cvAddDuty,
        toggleCardView,

        // ── Undo / Redo ──────────────────────────────────────────
        undo, redo,

        // ── Snapshots ────────────────────────────────────────────
        promptSnapshot, toggleSnapshotPanel, restoreSnapshot,

        // ── Clear All ────────────────────────────────────────────
        clearAll,

        // ── Image upload ─────────────────────────────────────────
        handleImageUpload, removeImage,

        // ── Info box ─────────────────────────────────────────────
        toggleInfoBox,

        // ── Additional Info ──────────────────────────────────────
        toggleEditHeading, clearSection,
        addCustomSection, removeCustomSection,

        // ── Save / Load ──────────────────────────────────────────
        saveToJSON, loadFromJSON,

        // ── Export ───────────────────────────────────────────────
        exportToWord, exportToPDF,

        // ── File Engine: Project Export / Import ─────────────────
        // exportProjectFile receives the active project id so the
        // user never has to pick which project to export.
        exportProjectFile: () => exportProjectFile(getActiveProject()?.id),
        importProjectFile,

        // ── Project Manager ──────────────────────────────────────
        pmSwitchProject: (id) => _switchToProject(id),

        pmNewProject: () => {
            const name = prompt('Project name:', 'New Project');
            if (name === null || !name.trim()) return;
            _saveCurrentProject();
            const proj = createProject(name.trim());
            setActiveProject(proj.id);
            persistProjects();
            _loadProjectIntoUI(proj);
            renderSidebar();
            showStatus('Created "' + escapeHtml(proj.name) + '" ✓', 'success');
        },

        pmDeleteProject: (id) => {
            const all  = getAllProjects();
            if (all.length <= 1) { alert('Cannot delete the only project.'); return; }
            const proj = all.find(p => p.id === id);
            if (!confirm('Delete "' + (proj?.name || 'this project') + '"?\nThis cannot be undone.')) return;
            const wasActive = getActiveProject()?.id === id;
            deleteProject(id);
            if (wasActive) {
                // deleteProject already set a new activeProjectId — load it
                _loadProjectIntoUI(getActiveProject());
            }
            persistProjects();
            renderSidebar();
            if (wasActive) showStatus('Project deleted. Switched to "' + escapeHtml(getActiveProject()?.name) + '"', 'success');
        },

        pmRenameProject: (id) => {
            const proj = getAllProjects().find(p => p.id === id);
            const newName = prompt('Rename project:', proj?.name || '');
            if (newName === null || !newName.trim()) return;
            renameProject(id, newName.trim());
            persistProjects();
            renderSidebar();
        },

        pmToggleSidebar:  ()     => _setSidebarState(!_sidebarOpen),
        pmFilterProjects: (text) => renderSidebar(text),
    });
});
