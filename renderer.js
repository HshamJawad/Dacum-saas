// ============================================================
// renderer.js — DOM Rendering Layer
// ============================================================
import { StateManager } from './state.js';
import {
    pushCommand,
    makeEditDutyCmd,
    makeEditTaskCmd
} from './history.js';
import {
    createCard,
    createHeader,
    createDeleteCircle,
    createEditable,
    createButton
} from './design-system.js';

// ── Action callbacks injected by app.js (avoids circular dep) ─
let _actions = {};
export function setRendererActions(actions) { _actions = actions; }

// ══════════════════════════════════════════════════════════════
//  Renderer — public API
// ══════════════════════════════════════════════════════════════
export const Renderer = {

    /** Entry point — call after every state change */
    renderAll(state) {
        this.renderTableView(state);
        if (state.isCardView) this.renderCardView(state);
    },

    /** Alias per spec naming */
    renderDuties(state) { this.renderTableView(state); },

    // ── TABLE VIEW ─────────────────────────────────────────────
    renderTableView(state) {
        const container = document.getElementById('dutiesContainer');
        if (!container) return;
        container.innerHTML = '';

        state.duties.forEach((duty, idx) => {
            const dutyNum = idx + 1;
            const dutyDiv = document.createElement('div');
            dutyDiv.className = 'duty-row';
            dutyDiv.id = duty.id;

            // Header
            const header = document.createElement('div');
            header.className = 'duty-header';

            const heading = document.createElement('h4');
            heading.textContent = 'Duty ' + dutyNum;

            const actions = document.createElement('div');
            actions.className = 'duty-header-actions';
            actions.appendChild(
                createButton({
                    type: 'ghost',
                    label: '🗑️ Clear',
                    onClick: () => _actions.clearDuty && _actions.clearDuty(duty.id)
                })
            );
            actions.appendChild(
                createButton({
                    type: 'danger',
                    label: '🗑️ Remove Duty',
                    onClick: () => _actions.removeDuty && _actions.removeDuty(duty.id)
                })
            );

            header.appendChild(heading);
            header.appendChild(actions);
            dutyDiv.appendChild(header);

            // Duty input
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

            this.renderTasks(duty, taskList);
            dutyDiv.appendChild(taskList);

            // Add Task button
            dutyDiv.appendChild(
                createButton({
                    type: 'primary',
                    label: '➕ Add Task',
                    onClick: () => _actions.addTask && _actions.addTask(duty.id)
                })
            );

            container.appendChild(dutyDiv);
        });
    },

    /** Render tasks into a task-list container (table view) */
    renderTasks(duty, taskList) {
        duty.tasks.forEach((task, tIdx) => {
            const taskDiv = document.createElement('div');
            taskDiv.className = 'task-item';
            taskDiv.id = task.id;

            const taskLabel = document.createElement('span');
            taskLabel.className = 'task-label';
            taskLabel.textContent = 'Task ' + (tIdx + 1) + ':';

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
                type: 'danger',
                label: '🗑️',
                onClick: () => _actions.removeTask && _actions.removeTask(task.id)
            });

            taskDiv.appendChild(taskLabel);
            taskDiv.appendChild(taskInput);
            taskDiv.appendChild(removeBtn);
            taskList.appendChild(taskDiv);
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
            // ── Outer scrollable row ──
            const row = document.createElement('div');
            row.className = 'cv-duty-row';

            // ── Duty sticky card ──
            const dutyIndexLabel = createHeader({ type: 'duty', index: idx + 1 });

            const deleteDutyBtn = createDeleteCircle({
                type: 'duty',
                title: 'Remove duty',
                onClick(e) {
                    e.stopPropagation();
                    if (confirm('Remove this duty and all its tasks?')) {
                        _actions.removeDuty && _actions.removeDuty(duty.id);
                    }
                }
            });

            const topRow = document.createElement('div');
            topRow.className = 'cv-duty-card-top';
            topRow.appendChild(dutyIndexLabel);
            topRow.appendChild(deleteDutyBtn);

            const dutyTextEl = createEditable({
                className: 'cv-duty-text',
                text: duty.title,
                placeholder: 'Enter duty',
                onFocus:  () => { dutyTextEl._prev = duty.title; },
                onInput:  () => { duty.title = dutyTextEl.textContent; },
                onBlur:   () => {
                    const newVal = duty.title;
                    if (newVal !== dutyTextEl._prev) {
                        pushCommand(makeEditDutyCmd(duty.id, dutyTextEl._prev, newVal));
                    }
                }
            });

            const dutyCard = document.createElement('div');
            dutyCard.className = 'cv-duty-card';
            dutyCard.appendChild(topRow);
            dutyCard.appendChild(dutyTextEl);
            row.appendChild(dutyCard);

            // ── Tasks wrapper ──
            const tasksWrapper = document.createElement('div');
            tasksWrapper.className = 'cv-tasks-wrapper';

            if (duty.tasks.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'cv-empty-note';
                empty.textContent = 'No tasks yet.';
                tasksWrapper.appendChild(empty);
            } else {
                duty.tasks.forEach((task, tIdx) => {
                    const taskLabel = document.createElement('div');
                    taskLabel.className = 'cv-task-label';
                    taskLabel.textContent = 'Task ' + (tIdx + 1);

                    const deleteTaskBtn = createDeleteCircle({
                        type: 'task',
                        title: 'Remove task',
                        onClick(e) {
                            e.stopPropagation();
                            _actions.removeTask && _actions.removeTask(task.id);
                        }
                    });

                    const taskTextEl = createEditable({
                        className: 'cv-task-text',
                        text: task.text,
                        placeholder: 'Enter task',
                        onFocus:  () => { taskTextEl._prev = task.text; },
                        onInput:  () => { task.text = taskTextEl.textContent; },
                        onBlur:   () => {
                            const newVal = task.text;
                            if (newVal !== taskTextEl._prev) {
                                pushCommand(makeEditTaskCmd(duty.id, task.id, taskTextEl._prev, newVal));
                            }
                        }
                    });

                    const taskCard = createCard({
                        type: 'task',
                        topLeft: taskLabel,
                        topRight: deleteTaskBtn,
                        content: taskTextEl
                    });

                    tasksWrapper.appendChild(taskCard);
                });
            }

            // Add Task button (card view)
            const addTaskBtn = document.createElement('button');
            addTaskBtn.className = 'btn btn-primary cv-add-task';
            addTaskBtn.innerHTML = '➕ Task';
            addTaskBtn.title = 'Add task to this duty';
            addTaskBtn.addEventListener('click', () => _actions.addTask && _actions.addTask(duty.id));
            tasksWrapper.appendChild(addTaskBtn);

            row.appendChild(tasksWrapper);
            inner.appendChild(row);
        });
    }
};

// ── Backward-compat shims for legacy inline onclick= handlers ─
export function renderApp()       { Renderer.renderAll(StateManager.state); }
export function renderTableView() { Renderer.renderTableView(StateManager.state); }
export function renderCardView()  { Renderer.renderCardView(StateManager.state); }
