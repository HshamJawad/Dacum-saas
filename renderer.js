// ============================================================
// renderer.js — DOM Rendering Layer  (DACUM Lite v3.1)
// ============================================================
import { AppState, StateManager } from './state.js';
import {
    pushCommand,
    makeEditDutyCmd,
    makeEditTaskCmd,
    makeMoveDutyCmd,
    makeMoveTaskCmd
} from './history.js';
import { saveToLocalStorage } from './storage.js';
import {
    createCard,
    createHeader,
    createDeleteCircle,
    createEditable,
    createButton
} from './design-system.js';

// ── Action callbacks injected by app.js ───────────────────────
let _actions = {};
export function setRendererActions(actions) { _actions = actions; }

// ══════════════════════════════════════════════════════════════
//  DACUM STANDARD NUMBERING  (v3.1)
//  Duty A … Z … AA … | Task A1, A2 … B1, B2 …
// ══════════════════════════════════════════════════════════════

function getDutyLetter(idx) {
    const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (idx < 26) return L[idx];
    return L[Math.floor(idx / 26) - 1] + L[idx % 26];
}

function dutyLabel(idx)              { return 'Duty ' + getDutyLetter(idx); }
function taskLabel(dutyIdx, taskIdx) { return getDutyLetter(dutyIdx) + (taskIdx + 1); }

// ══════════════════════════════════════════════════════════════
//  DRAG STATE  (module-level singleton)
// ══════════════════════════════════════════════════════════════

const _drag = { type: null, dutyId: null, taskId: null, el: null };

function _resetDrag() { _drag.type = _drag.dutyId = _drag.taskId = _drag.el = null; }

function _clearAllDragClasses() {
    document.querySelectorAll('.drag-over-top,.drag-over-bottom,.drag-over-empty')
        .forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-empty'));
}

// ══════════════════════════════════════════════════════════════
//  DUTY DRAG-AND-DROP
//
//  KEY FIX (v3.1.1):
//  Instead of splitting by mouse position within the target
//  (which caused no-op bugs when dragging top→bottom), we use
//  the DRAG DIRECTION to decide insert-before vs insert-after:
//    • Dragging DOWN  (fromIdx < targetIdx) → insert AFTER target
//    • Dragging UP    (fromIdx > targetIdx) → insert BEFORE target
//  This is unambiguous and matches user expectations.
// ══════════════════════════════════════════════════════════════

/**
 * @param {HTMLElement} dutyEl  draggable container (.duty-row / .cv-duty-row)
 * @param {HTMLElement} handle  ⠿ grip element — mousedown enables dragging
 * @param {object}      duty    duty data object
 * @param {'y'|'x'}    axis    'y' = table view, 'x' = card view
 */
function _attachDutyDragListeners(dutyEl, handle, duty, axis) {
    handle.addEventListener('mousedown', () => { dutyEl.draggable = true; });

    dutyEl.addEventListener('dragstart', (e) => {
        if (!dutyEl.draggable) { e.preventDefault(); return; }
        _drag.type   = 'duty';
        _drag.dutyId = duty.id;
        _drag.el     = dutyEl;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', duty.id);
        setTimeout(() => dutyEl.classList.add('dragging'), 0);
    });

    dutyEl.addEventListener('dragend', () => {
        dutyEl.draggable = false;
        dutyEl.classList.remove('dragging');
        _clearAllDragClasses();
        _resetDrag();
    });

    dutyEl.addEventListener('dragover', (e) => {
        if (_drag.type !== 'duty' || _drag.dutyId === duty.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        // Use drag direction, not cursor position within element.
        const fromIdx   = AppState.duties.findIndex(d => d.id === _drag.dutyId);
        const targetIdx = AppState.duties.findIndex(d => d.id === duty.id);
        // Dragging down → will insert AFTER (show bottom indicator)
        // Dragging up   → will insert BEFORE (show top indicator)
        const insertBefore = fromIdx > targetIdx;

        dutyEl.classList.remove('drag-over-top', 'drag-over-bottom');
        dutyEl.classList.add(insertBefore ? 'drag-over-top' : 'drag-over-bottom');
    });

    dutyEl.addEventListener('dragleave', (e) => {
        if (!dutyEl.contains(e.relatedTarget))
            dutyEl.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    dutyEl.addEventListener('drop', (e) => {
        if (_drag.type !== 'duty' || _drag.dutyId === duty.id) return;
        e.preventDefault();
        dutyEl.classList.remove('drag-over-top', 'drag-over-bottom');

        const fromIdx   = AppState.duties.findIndex(d => d.id === _drag.dutyId);
        const targetIdx = AppState.duties.findIndex(d => d.id === duty.id);
        if (fromIdx === -1 || targetIdx === -1) return;

        // Same directional rule as dragover:
        //   dragging down → insertIdx = targetIdx + 1
        //   dragging up   → insertIdx = targetIdx
        const insertBefore = fromIdx > targetIdx;
        const insertIdx    = insertBefore ? targetIdx : targetIdx + 1;
        // After splicing out fromIdx, every index ≥ fromIdx shifts down by 1
        const finalIdx     = fromIdx < insertIdx ? insertIdx - 1 : insertIdx;

        if (fromIdx === finalIdx) return;   // guard (shouldn't happen now)

        const cmd = makeMoveDutyCmd(fromIdx, finalIdx);
        cmd.execute();
        pushCommand(cmd);
        saveToLocalStorage();
        Renderer.renderAll(StateManager.state);
    });
}

// ══════════════════════════════════════════════════════════════
//  TASK DRAG-AND-DROP
//  Tasks use cursor position (top/bottom half) because tasks are
//  small and the direction is always clear within a short list.
// ══════════════════════════════════════════════════════════════

function _attachTaskDragListeners(taskEl, handle, dutyRef, taskRef) {
    handle.addEventListener('mousedown', () => { taskEl.draggable = true; });

    taskEl.addEventListener('dragstart', (e) => {
        if (!taskEl.draggable) { e.preventDefault(); return; }
        _drag.type   = 'task';
        _drag.dutyId = dutyRef.id;
        _drag.taskId = taskRef.id;
        _drag.el     = taskEl;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', taskRef.id);
        e.stopPropagation();    // don't bubble to duty dragstart
        setTimeout(() => taskEl.classList.add('dragging'), 0);
    });

    taskEl.addEventListener('dragend', () => {
        taskEl.draggable = false;
        taskEl.classList.remove('dragging');
        _clearAllDragClasses();
        _resetDrag();
    });

    taskEl.addEventListener('dragover', (e) => {
        if (_drag.type !== 'task') return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const rect = taskEl.getBoundingClientRect();
        taskEl.classList.remove('drag-over-top', 'drag-over-bottom');
        taskEl.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drag-over-top' : 'drag-over-bottom');
    });

    taskEl.addEventListener('dragleave', (e) => {
        if (!taskEl.contains(e.relatedTarget))
            taskEl.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    taskEl.addEventListener('drop', (e) => {
        if (_drag.type !== 'task') return;
        e.preventDefault();
        e.stopPropagation();
        taskEl.classList.remove('drag-over-top', 'drag-over-bottom');

        const srcDuty = AppState.duties.find(d => d.id === _drag.dutyId);
        const tgtDuty = AppState.duties.find(d => d.id === dutyRef.id);
        if (!srcDuty || !tgtDuty) return;

        const fromTaskIdx   = srcDuty.tasks.findIndex(t => t.id === _drag.taskId);
        const targetTaskIdx = tgtDuty.tasks.findIndex(t => t.id === taskRef.id);
        if (fromTaskIdx === -1 || targetTaskIdx === -1) return;

        const rect         = taskEl.getBoundingClientRect();
        const insertBefore = e.clientY < rect.top + rect.height / 2;
        const toInsertIdx  = insertBefore ? targetTaskIdx : targetTaskIdx + 1;

        const sameList       = _drag.dutyId === dutyRef.id;
        const finalInsertIdx = (sameList && fromTaskIdx < toInsertIdx) ? toInsertIdx - 1 : toInsertIdx;
        if (sameList && fromTaskIdx === finalInsertIdx) return;

        const cmd = makeMoveTaskCmd(_drag.taskId, _drag.dutyId, fromTaskIdx, dutyRef.id, toInsertIdx);
        cmd.execute();
        pushCommand(cmd);
        saveToLocalStorage();
        Renderer.renderAll(StateManager.state);
    });
}

/** Drop zone for empty task lists or end-of-list drops */
function _attachTaskListDropZone(listEl, dutyRef) {
    listEl.addEventListener('dragover', (e) => {
        if (_drag.type !== 'task') return;
        if (e.target !== listEl &&
            listEl.contains(e.target) &&
            !e.target.classList.contains('cv-empty-note')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        listEl.classList.add('drag-over-empty');
    });

    listEl.addEventListener('dragleave', (e) => {
        if (!listEl.contains(e.relatedTarget))
            listEl.classList.remove('drag-over-empty');
    });

    listEl.addEventListener('drop', (e) => {
        if (_drag.type !== 'task') return;
        if (e.target !== listEl &&
            listEl.contains(e.target) &&
            !e.target.classList.contains('cv-empty-note') &&
            !e.target.classList.contains('drag-over-empty')) return;
        e.preventDefault();
        listEl.classList.remove('drag-over-empty');

        const srcDuty = AppState.duties.find(d => d.id === _drag.dutyId);
        const tgtDuty = AppState.duties.find(d => d.id === dutyRef.id);
        if (!srcDuty || !tgtDuty) return;

        const fromTaskIdx = srcDuty.tasks.findIndex(t => t.id === _drag.taskId);
        if (fromTaskIdx === -1) return;

        const toInsertIdx = tgtDuty.tasks.length;
        const sameList    = _drag.dutyId === dutyRef.id;
        if (sameList && fromTaskIdx === tgtDuty.tasks.length - 1) return;

        const cmd = makeMoveTaskCmd(_drag.taskId, _drag.dutyId, fromTaskIdx, dutyRef.id, toInsertIdx);
        cmd.execute();
        pushCommand(cmd);
        saveToLocalStorage();
        Renderer.renderAll(StateManager.state);
    });
}

// ══════════════════════════════════════════════════════════════
//  Renderer — public API
// ══════════════════════════════════════════════════════════════
export const Renderer = {

    renderAll(state) {
        this.renderTableView(state);
        if (state.isCardView) this.renderCardView(state);
        // Refresh wall view in place if it's currently visible
        const wvEl = document.getElementById('wallViewContainer');
        if (wvEl && wvEl.classList.contains('wv-visible')) {
            this.renderWallView(state);
        }
    },

    renderDuties(state) { this.renderTableView(state); },

    // ── TABLE VIEW ─────────────────────────────────────────────
    renderTableView(state) {
        const container = document.getElementById('dutiesContainer');
        if (!container) return;
        container.innerHTML = '';

        state.duties.forEach((duty, idx) => {
            const dutyDiv = document.createElement('div');
            dutyDiv.className = 'duty-row';
            dutyDiv.id = duty.id;

            // Header
            const header = document.createElement('div');
            header.className = 'duty-header';

            const dragHandle = document.createElement('span');
            dragHandle.className = 'duty-drag-handle';
            dragHandle.textContent = '⠿';
            dragHandle.title = 'Drag to reorder duties';

            const heading = document.createElement('h4');
            heading.textContent = dutyLabel(idx);   // "Duty A", "Duty B" …

            const actions = document.createElement('div');
            actions.className = 'duty-header-actions';
            actions.appendChild(createButton({
                type: 'clear-section', label: '🗑️ Clear',
                onClick: () => _actions.clearDuty && _actions.clearDuty(duty.id)
            }));
            actions.appendChild(createButton({
                type: 'remove', label: '🗑️ Remove Duty',
                onClick: () => _actions.removeDuty && _actions.removeDuty(duty.id)
            }));

            header.appendChild(dragHandle);
            header.appendChild(heading);
            header.appendChild(actions);
            dutyDiv.appendChild(header);

            // Duty description input
            const dutyInput = document.createElement('input');
            dutyInput.type = 'text';
            dutyInput.placeholder = 'Enter duty description';
            dutyInput.setAttribute('data-duty-id', duty.id);
            dutyInput.value = duty.title;

            (dutyRef => {
                let prevVal = dutyRef.title;
                dutyInput.addEventListener('focus', () => { prevVal = dutyRef.title; });
                dutyInput.addEventListener('input', () => { dutyRef.title = dutyInput.value; });
                dutyInput.addEventListener('blur', () => {
                    const newVal = dutyRef.title;
                    if (newVal !== prevVal) {
                        pushCommand(makeEditDutyCmd(dutyRef.id, prevVal, newVal));
                        prevVal = newVal;
                    }
                });
            })(duty);

            dutyDiv.appendChild(dutyInput);

            // Task list
            const taskList = document.createElement('div');
            taskList.className = 'task-list';
            taskList.id = 'tasks_' + duty.id;

            this.renderTasks(duty, taskList, idx);
            _attachTaskListDropZone(taskList, duty);
            dutyDiv.appendChild(taskList);

            // Add Task button
            dutyDiv.appendChild(createButton({
                type: 'add', label: '➕ Add Task',
                onClick: () => _actions.addTask && _actions.addTask(duty.id)
            }));

            container.appendChild(dutyDiv);
            // Attach duty DnD — vertical axis for table view
            _attachDutyDragListeners(dutyDiv, dragHandle, duty, 'y');
        });
    },

    renderTasks(duty, taskList, dutyIdx) {
        duty.tasks.forEach((task, tIdx) => {
            const taskDiv = document.createElement('div');
            taskDiv.className = 'task-item';
            taskDiv.id = task.id;

            const dragHandle = document.createElement('span');
            dragHandle.className = 'task-drag-handle';
            dragHandle.textContent = '⠿';
            dragHandle.title = 'Drag to reorder or move to another duty';

            const label = document.createElement('span');
            label.className = 'task-label';
            label.textContent = taskLabel(dutyIdx, tIdx) + ':';   // "A1:", "B3:"…

            const taskInput = document.createElement('input');
            taskInput.type = 'text';
            taskInput.style.flex = '1';
            taskInput.placeholder = 'Enter task description';
            taskInput.setAttribute('data-task-id', task.id);
            taskInput.value = task.text;

            (function(dutyRef, taskRef) {
                let prevVal = taskRef.text;
                taskInput.addEventListener('focus', () => { prevVal = taskRef.text; });
                taskInput.addEventListener('input', () => { taskRef.text = taskInput.value; });
                taskInput.addEventListener('blur', () => {
                    const newVal = taskRef.text;
                    if (newVal !== prevVal) {
                        pushCommand(makeEditTaskCmd(dutyRef.id, taskRef.id, prevVal, newVal));
                        prevVal = newVal;
                    }
                });
            })(duty, task);

            const removeBtn = createButton({
                type: 'remove', label: '🗑️',
                onClick: () => _actions.removeTask && _actions.removeTask(task.id)
            });

            taskDiv.appendChild(dragHandle);
            taskDiv.appendChild(label);
            taskDiv.appendChild(taskInput);
            taskDiv.appendChild(removeBtn);
            taskList.appendChild(taskDiv);

            _attachTaskDragListeners(taskDiv, dragHandle, duty, task);
        });
    },

    // ── WALL VIEW ──────────────────────────────────────────────
    /**
     * Renders the Wall View chart (full-screen overlay).
     * Each duty = one horizontal row: [Duty Card][Task...Task...]
     * Supports drag-and-drop for duties (vertical) and tasks
     * (within same duty or across duties) — same logic as table/card.
     */
    renderWallView(state) {
        const chart = document.getElementById('wvChart');
        if (!chart) return;
        chart.innerHTML = '';

        if (!state.duties || state.duties.length === 0) {
            chart.innerHTML =
                '<p style="color:#64748b;font-style:italic;padding:24px 0;">No duties added yet. ' +
                'Go to the Duties & Tasks tab to add duties.</p>';
            return;
        }

        state.duties.forEach((duty, idx) => {
            const letter = getDutyLetter(idx);

            // ── Full duty row (draggable unit) ─────────────────
            const row = document.createElement('div');
            row.className = 'wv-duty-row';
            row.id = 'wv_' + duty.id;

            // ── Duty card (indigo) ─────────────────────────────
            const dutyCard = document.createElement('div');
            dutyCard.className = 'wv-duty-card';

            // Drag handle — top of the duty card
            const dutyDragHandle = document.createElement('span');
            dutyDragHandle.className = 'wv-duty-drag-handle';
            dutyDragHandle.textContent = '⠿';
            dutyDragHandle.title = 'Drag to reorder duties';

            const badge = document.createElement('div');
            badge.className = 'wv-duty-badge';
            badge.textContent = 'Duty ' + letter;

            const titleEl = document.createElement('div');
            titleEl.className = duty.title
                ? 'wv-duty-title'
                : 'wv-duty-title wv-duty-title-empty';
            titleEl.textContent = duty.title || '(No description)';

            const badgeRow = document.createElement('div');
            badgeRow.className = 'wv-duty-badge-row';
            badgeRow.appendChild(dutyDragHandle);
            badgeRow.appendChild(badge);

            dutyCard.appendChild(badgeRow);
            dutyCard.appendChild(titleEl);
            row.appendChild(dutyCard);

            // ── Tasks grid ─────────────────────────────────────
            const grid = document.createElement('div');
            grid.className = 'wv-tasks-grid';

            if (duty.tasks.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'wv-no-tasks';
                empty.textContent = 'No tasks yet — drop here.';
                grid.appendChild(empty);
            } else {
                duty.tasks.forEach((task, tIdx) => {
                    const card = document.createElement('div');
                    card.className = 'wv-task-card';

                    // Task drag handle
                    const taskDragHandle = document.createElement('span');
                    taskDragHandle.className = 'wv-task-drag-handle';
                    taskDragHandle.textContent = '⠿';
                    taskDragHandle.title = 'Drag to reorder or move to another duty';

                    const labelRow = document.createElement('div');
                    labelRow.className = 'wv-task-label-row';
                    labelRow.appendChild(taskDragHandle);

                    const lbl = document.createElement('span');
                    lbl.className = 'wv-task-label';
                    lbl.textContent = 'Task ' + letter + (tIdx + 1);
                    labelRow.appendChild(lbl);

                    const txt = document.createElement('div');
                    txt.className = 'wv-task-text';
                    txt.textContent = task.text || '';

                    card.appendChild(labelRow);
                    card.appendChild(txt);
                    grid.appendChild(card);

                    // Wire task drag-and-drop (reuse existing logic)
                    _attachTaskDragListeners(card, taskDragHandle, duty, task);
                });
            }

            // Drop zone for empty grid / end-of-list drops
            _attachTaskListDropZone(grid, duty);

            row.appendChild(grid);
            chart.appendChild(row);

            // Wire duty drag-and-drop — vertical axis (same as table view)
            _attachDutyDragListeners(row, dutyDragHandle, duty, 'y');
        });
    },

    // ── CARD VIEW ──────────────────────────────────────────────
    renderCardView(state) {
        const inner = document.getElementById('cardViewInner');
        if (!inner) return;
        inner.innerHTML = '';

        if (state.duties.length === 0) {
            inner.innerHTML = '<p style="color:#a16207;font-style:italic;padding:12px;">No duties added yet.</p>';
            return;
        }

        state.duties.forEach((duty, idx) => {
            const letter = getDutyLetter(idx);

            const row = document.createElement('div');
            row.className = 'cv-duty-row';

            // Duty card (sticky side panel)
            const dutyDragHandle = document.createElement('span');
            dutyDragHandle.className = 'duty-drag-handle cv-duty-drag-handle';
            dutyDragHandle.textContent = '⠿';
            dutyDragHandle.title = 'Drag to reorder duties';

            const dutyIndexLabel = createHeader({ type: 'duty', index: letter });

            const deleteDutyBtn = createDeleteCircle({
                type: 'duty', title: 'Remove duty',
                onClick(e) {
                    e.stopPropagation();
                    if (confirm('Remove this duty and all its tasks?'))
                        _actions.removeDuty && _actions.removeDuty(duty.id);
                }
            });

            const topRow = document.createElement('div');
            topRow.className = 'cv-duty-card-top';
            topRow.appendChild(dutyDragHandle);
            topRow.appendChild(dutyIndexLabel);
            topRow.appendChild(deleteDutyBtn);

            const dutyTextEl = createEditable({
                className: 'cv-duty-text', text: duty.title, placeholder: 'Enter duty',
                onFocus: () => { dutyTextEl._prev = duty.title; },
                onInput: () => { duty.title = dutyTextEl.textContent; },
                onBlur:  () => {
                    const newVal = duty.title;
                    if (newVal !== dutyTextEl._prev)
                        pushCommand(makeEditDutyCmd(duty.id, dutyTextEl._prev, newVal));
                }
            });

            const dutyCard = document.createElement('div');
            dutyCard.className = 'cv-duty-card';
            dutyCard.appendChild(topRow);
            dutyCard.appendChild(dutyTextEl);
            row.appendChild(dutyCard);

            // Tasks wrapper
            const tasksWrapper = document.createElement('div');
            tasksWrapper.className = 'cv-tasks-wrapper';

            if (duty.tasks.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'cv-empty-note';
                empty.textContent = 'No tasks yet.';
                tasksWrapper.appendChild(empty);
            } else {
                duty.tasks.forEach((task, tIdx) => {
                    const taskDragHandle = document.createElement('span');
                    taskDragHandle.className = 'task-drag-handle cv-task-drag-handle';
                    taskDragHandle.textContent = '⠿';
                    taskDragHandle.title = 'Drag to reorder or move task';

                    const labelEl = document.createElement('div');
                    labelEl.className = 'cv-task-label';
                    labelEl.textContent = taskLabel(idx, tIdx);   // "A1", "B3"…

                    const deleteTaskBtn = createDeleteCircle({
                        type: 'task', title: 'Remove task',
                        onClick(e) {
                            e.stopPropagation();
                            _actions.removeTask && _actions.removeTask(task.id);
                        }
                    });

                    const taskTextEl = createEditable({
                        className: 'cv-task-text', text: task.text, placeholder: 'Enter task',
                        onFocus: () => { taskTextEl._prev = task.text; },
                        onInput: () => { task.text = taskTextEl.textContent; },
                        onBlur:  () => {
                            const newVal = task.text;
                            if (newVal !== taskTextEl._prev)
                                pushCommand(makeEditTaskCmd(duty.id, task.id, taskTextEl._prev, newVal));
                        }
                    });

                    const topLeftEl = document.createElement('div');
                    topLeftEl.style.cssText = 'display:flex;align-items:center;gap:4px;';
                    topLeftEl.appendChild(taskDragHandle);
                    topLeftEl.appendChild(labelEl);

                    const taskCard = createCard({
                        type: 'task',
                        topLeft: topLeftEl,
                        topRight: deleteTaskBtn,
                        content: taskTextEl
                    });

                    tasksWrapper.appendChild(taskCard);
                    _attachTaskDragListeners(taskCard, taskDragHandle, duty, task);
                });
            }

            _attachTaskListDropZone(tasksWrapper, duty);

            const addTaskBtn = document.createElement('button');
            addTaskBtn.className = 'cv-add-task';
            addTaskBtn.innerHTML = '➕ Task';
            addTaskBtn.title = 'Add task to this duty';
            addTaskBtn.addEventListener('click', () => _actions.addTask && _actions.addTask(duty.id));
            tasksWrapper.appendChild(addTaskBtn);

            row.appendChild(tasksWrapper);
            inner.appendChild(row);

            // Card view duty DnD — horizontal axis
            _attachDutyDragListeners(row, dutyDragHandle, duty, 'x');
        });
    }
};

// ── Backward-compat shims ─────────────────────────────────────
export function renderApp()       { Renderer.renderAll(StateManager.state); }
export function renderTableView() { Renderer.renderTableView(StateManager.state); }
export function renderCardView()  { Renderer.renderCardView(StateManager.state); }
