// ============================================================
// history.js — Command-Based Undo / Redo + Per-Project Snapshots
// ============================================================
import { AppState, StateManager } from './state.js';
import { saveToLocalStorage } from './storage.js';
import { showStatus } from './design-system.js';
import ProjectManager from './project-manager.js';

// ── Utilities ────────────────────────────────────────────────
export function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

export function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;');
}

// ── Render injection (set by app.js to avoid circular dep) ───
let _renderFn = null;
export function setHistoryRender(fn) { _renderFn = fn; }

// ── Core: push a fully-formed command ────────────────────────
export function pushCommand(cmd) {
    StateManager.undoStack.push(cmd);
    if (StateManager.undoStack.length > StateManager.MAX_HISTORY) {
        StateManager.undoStack.shift();
    }
    StateManager.redoStack = [];
    saveToLocalStorage();
    updateHistoryButtons();
}

// ── Undo ─────────────────────────────────────────────────────
export function undo() {
    if (StateManager.undoStack.length === 0) return;
    const cmd = StateManager.undoStack.pop();
    cmd.undo();
    StateManager.redoStack.push(cmd);
    saveToLocalStorage();
    updateHistoryButtons();
    if (_renderFn) _renderFn(StateManager.state);
    showStatus('↩ Undone: ' + cmd.type, 'success');
}

// ── Redo ─────────────────────────────────────────────────────
export function redo() {
    if (StateManager.redoStack.length === 0) return;
    const cmd = StateManager.redoStack.pop();
    cmd.execute();
    StateManager.undoStack.push(cmd);
    saveToLocalStorage();
    updateHistoryButtons();
    if (_renderFn) _renderFn(StateManager.state);
    showStatus('↪ Redone: ' + cmd.type, 'success');
}

// ── Update UI button states ───────────────────────────────────
export function updateHistoryButtons() {
    const canUndo = StateManager.undoStack.length > 0;
    const canRedo = StateManager.redoStack.length > 0;
    ['floatUndoBtn', 'undoBtn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = !canUndo;
    });
    ['floatRedoBtn', 'redoBtn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = !canRedo;
    });
}

// ══════════════════════════════════════════════════════════════
//  COMMAND FACTORIES
//  Each returns { type, payload, execute(), undo() }
// ══════════════════════════════════════════════════════════════

/** ADD_DUTY */
export function makeAddDutyCmd(dutyObj) {
    return {
        type: 'ADD_DUTY',
        payload: { dutyId: dutyObj.id },
        execute() {
            AppState.taskCounts[dutyObj.id] = AppState.taskCounts[dutyObj.id] || 0;
            AppState.duties.push(deepClone(dutyObj));
        },
        undo() {
            AppState.duties = AppState.duties.filter(d => d.id !== dutyObj.id);
        }
    };
}

/** DELETE_DUTY — stores index so undo re-inserts at exact position */
export function makeDeleteDutyCmd(dutyId) {
    const idx   = AppState.duties.findIndex(d => d.id === dutyId);
    const saved = deepClone(AppState.duties[idx]);
    return {
        type: 'DELETE_DUTY',
        payload: { dutyId, index: idx },
        execute() {
            AppState.duties = AppState.duties.filter(d => d.id !== dutyId);
        },
        undo() {
            AppState.duties.splice(
                saved._insertIdx !== undefined ? saved._insertIdx : idx,
                0,
                deepClone(saved)
            );
        }
    };
}

/** EDIT_DUTY */
export function makeEditDutyCmd(dutyId, oldVal, newVal) {
    return {
        type: 'EDIT_DUTY',
        payload: { dutyId, oldVal, newVal },
        execute() {
            const d = AppState.duties.find(d => d.id === dutyId);
            if (d) d.title = newVal;
        },
        undo() {
            const d = AppState.duties.find(d => d.id === dutyId);
            if (d) d.title = oldVal;
        }
    };
}

/** ADD_TASK */
export function makeAddTaskCmd(dutyId, taskObj) {
    return {
        type: 'ADD_TASK',
        payload: { dutyId, taskId: taskObj.id },
        execute() {
            const duty = AppState.duties.find(d => d.id === dutyId);
            if (duty) duty.tasks.push(deepClone(taskObj));
        },
        undo() {
            const duty = AppState.duties.find(d => d.id === dutyId);
            if (duty) duty.tasks = duty.tasks.filter(t => t.id !== taskObj.id);
        }
    };
}

/** DELETE_TASK — stores original index for correct re-insertion */
export function makeDeleteTaskCmd(taskId) {
    let foundDuty = null, savedTask = null, savedIdx = -1;
    AppState.duties.forEach(d => {
        const ti = d.tasks.findIndex(t => t.id === taskId);
        if (ti !== -1) { foundDuty = d.id; savedTask = deepClone(d.tasks[ti]); savedIdx = ti; }
    });
    return {
        type: 'DELETE_TASK',
        payload: { dutyId: foundDuty, taskId, index: savedIdx },
        execute() {
            const d = AppState.duties.find(d => d.id === foundDuty);
            if (d) d.tasks = d.tasks.filter(t => t.id !== taskId);
        },
        undo() {
            const d = AppState.duties.find(d => d.id === foundDuty);
            if (d) d.tasks.splice(savedIdx, 0, deepClone(savedTask));
        }
    };
}

/** EDIT_TASK */
export function makeEditTaskCmd(dutyId, taskId, oldVal, newVal) {
    return {
        type: 'EDIT_TASK',
        payload: { dutyId, taskId, oldVal, newVal },
        execute() {
            const d = AppState.duties.find(d => d.id === dutyId);
            if (d) { const t = d.tasks.find(t => t.id === taskId); if (t) t.text = newVal; }
        },
        undo() {
            const d = AppState.duties.find(d => d.id === dutyId);
            if (d) { const t = d.tasks.find(t => t.id === taskId); if (t) t.text = oldVal; }
        }
    };
}

/** CLEAR_ALL — stores entire prior state for single-step undo */
export function makeClearAllCmd(priorDuties, priorDutyCount, priorTaskCounts) {
    return {
        type: 'CLEAR_ALL',
        payload: {},
        execute() {
            AppState.duties     = [];
            AppState.taskCounts = {};
            AppState.dutyCount  = 0;
        },
        undo() {
            AppState.duties     = deepClone(priorDuties);
            AppState.taskCounts = deepClone(priorTaskCounts);
            AppState.dutyCount  = priorDutyCount;
        }
    };
}

// ══════════════════════════════════════════════════════════════
//  SNAPSHOT VERSIONING — per-project
//
//  SnapshotManager is a live proxy to the active project's
//  snapshots array.  All code that accesses .snapshots will
//  automatically read/write the correct project's list.
// ══════════════════════════════════════════════════════════════

export const SnapshotManager = {
    /** Always returns the active project's snapshot array */
    get snapshots() {
        const p = ProjectManager.getActiveProject();
        return p ? p.snapshots : [];
    }
};

export function createSnapshot(label) {
    const proj = ProjectManager.getActiveProject();
    if (!proj) return;

    label = label || ('Snapshot ' + (proj.snapshots.length + 1));
    proj.snapshots.push({
        label,
        timestamp: new Date().toISOString(),
        state:     deepClone(AppState)
    });
    if (proj.snapshots.length > 20) proj.snapshots.shift();

    refreshSnapshotList();
    saveToLocalStorage();   // also persists the new snapshot
    showStatus('Snapshot saved: "' + label + '" ✓', 'success');
}

export function restoreSnapshot(index) {
    const proj = ProjectManager.getActiveProject();
    if (!proj) return;
    const snap = proj.snapshots[index];
    if (!snap) return;

    const prior = deepClone(AppState);
    const cmd = {
        type: 'RESTORE_SNAPSHOT',
        payload: { label: snap.label },
        execute() { Object.assign(AppState, deepClone(snap.state)); },
        undo()    { Object.assign(AppState, prior); }
    };
    cmd.execute();
    pushCommand(cmd);
    if (_renderFn) _renderFn(StateManager.state);
    showStatus('Snapshot restored: "' + snap.label + '" ✓', 'success');
}

export function promptSnapshot() {
    const label = prompt('Name this snapshot (leave blank for auto-name):', '');
    if (label === null) return;
    createSnapshot(label.trim() || undefined);
}

export function refreshSnapshotList() {
    const list = document.getElementById('snapshotList');
    if (!list) return;
    const snaps = SnapshotManager.snapshots;

    if (snaps.length === 0) {
        list.innerHTML = '<div class="snap-empty">No snapshots yet. Click 📸 to save one.</div>';
        return;
    }
    list.innerHTML = '';
    const reversed = snaps.slice().reverse();
    reversed.forEach((snap, i) => {
        const realIdx = snaps.length - 1 - i;
        const d = new Date(snap.timestamp);
        const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
        const item = document.createElement('div');
        item.className = 'snap-item';
        item.innerHTML =
            '<div>' +
                '<div class="snap-item-label">' + escapeHtml(snap.label) + '</div>' +
                '<div class="snap-item-time">' + dateStr + ' ' + timeStr +
                    ' · ' + (snap.state.duties || []).length + ' duties</div>' +
            '</div>' +
            '<button class="snap-restore-btn" onclick="window.restoreSnapshot(' + realIdx + ')' +
                '; window.toggleSnapshotPanel();">Restore</button>';
        list.appendChild(item);
    });
}

export function toggleSnapshotPanel() {
    const panel = document.getElementById('snapshotPanel');
    if (!panel) return;
    if (panel.style.display === 'none' || panel.style.display === '') {
        refreshSnapshotList();
        panel.style.display = 'block';
    } else {
        panel.style.display = 'none';
    }
    openStateInspector();
}

// ── Debug console inspector ───────────────────────────────────
export function openStateInspector() {
    console.group('%c DACUM Command Inspector', 'color:#667eea;font-weight:bold;font-size:14px');
    console.log('%cAppState', 'color:#10b981;font-weight:bold', deepClone(StateManager.state));
    console.log('%cUndo Stack (' + StateManager.undoStack.length + ')', 'color:#f59e0b;font-weight:bold',
        StateManager.undoStack.map(c => c.type));
    console.log('%cRedo Stack (' + StateManager.redoStack.length + ')', 'color:#ef4444;font-weight:bold',
        StateManager.redoStack.map(c => c.type));
    console.log('%cSnapshots (' + SnapshotManager.snapshots.length + ')', 'color:#0ea5e9;font-weight:bold',
        SnapshotManager.snapshots.map(s => s.label));
    const proj = ProjectManager.getActiveProject();
    if (proj) console.log('%cActive Project', 'color:#a855f7;font-weight:bold',
        proj.name, '— id:', proj.id);
    console.groupEnd();
}
