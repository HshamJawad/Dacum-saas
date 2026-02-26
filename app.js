// ============================================================
// app.js — Application Bootstrap
// Connects all modules and initializes on DOMContentLoaded.
// ============================================================
import { AppState, StateManager } from './state.js';
import { showStatus } from './design-system.js';
import {
    undo, redo, updateHistoryButtons, setHistoryRender,
    promptSnapshot, toggleSnapshotPanel, restoreSnapshot
} from './history.js';
import { saveToLocalStorage, loadFromLocalStorage } from './storage.js';
import { Renderer, setRendererActions } from './renderer.js';
import {
    EventBinder,
    addDuty, removeDuty, addTask, removeTask,
    clearDuty, cvAddDuty, clearAll, toggleCardView,
    handleImageUpload, removeImage,
    toggleInfoBox, toggleEditHeading, clearSection,
    addCustomSection, removeCustomSection,
    saveToJSON, loadFromJSON,
    exportToWord, exportToPDF
} from './events.js';

// ── Wire cross-module render reference ────────────────────────
// history.js needs to call Renderer.renderAll after undo/redo
setHistoryRender(state => Renderer.renderAll(state));

// ── Wire action callbacks into Renderer ───────────────────────
// Renderer needs to call addTask / removeDuty etc. but cannot
// import from events.js directly (would create a circular dep).
setRendererActions({ addDuty, removeDuty, addTask, removeTask, clearDuty });

// ── Wire StateManager callbacks ───────────────────────────────
StateManager.configure({
    save:   saveToLocalStorage,
    render: state => Renderer.renderAll(state)
});

// ══════════════════════════════════════════════════════════════
//  DOMContentLoaded — bootstrap
// ══════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
    // Restore persisted state or seed a blank first duty
    const restored = loadFromLocalStorage();
    if (!restored || AppState.duties.length === 0) {
        AppState.dutyCount++;
        const dutyId = 'duty_' + AppState.dutyCount;
        AppState.taskCounts[dutyId] = 1;
        const taskId = 'task_' + dutyId + '_1';
        AppState.duties.push({ id: dutyId, title: '', tasks: [{ id: taskId, text: '' }] });
    }

    updateHistoryButtons();
    Renderer.renderAll(StateManager.state);
    EventBinder.init();

    // ── Expose everything to the global window ─────────────────
    // Inline onclick="..." attributes in the HTML need global access.
    // All logic still lives in modules; these are thin pass-throughs.
    Object.assign(window, {
        // Duty / Task
        addDuty, removeDuty, addTask, removeTask, clearDuty, cvAddDuty,
        toggleCardView,

        // Undo / Redo
        undo, redo,

        // Snapshots
        promptSnapshot, toggleSnapshotPanel, restoreSnapshot,

        // Clear All
        clearAll,

        // Image upload
        handleImageUpload, removeImage,

        // Info box
        toggleInfoBox,

        // Additional Info
        toggleEditHeading, clearSection,
        addCustomSection, removeCustomSection,

        // Save / Load
        saveToJSON, loadFromJSON,

        // Export
        exportToWord, exportToPDF
    });
});
