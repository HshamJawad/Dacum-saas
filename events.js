// ============================================================
// events.js — Feature Functions & Event Binding Layer
// ============================================================
import { AppState, StateManager } from './state.js';
import {
    pushCommand, undo, redo,
    makeAddDutyCmd, makeDeleteDutyCmd,
    makeAddTaskCmd, makeDeleteTaskCmd,
    makeClearAllCmd,
    updateHistoryButtons
} from './history.js';
import { saveToLocalStorage, loadFromLocalStorage } from './storage.js';
import { Renderer } from './renderer.js';
import { showStatus } from './design-system.js';
import { exportProject, importProject } from './fileEngine.js';

// ── Image state (module-level) ────────────────────────────────
export let producedForImage = null;
export let producedByImage  = null;
export function setProducedForImage(v) { producedForImage = v; }
export function setProducedByImage(v)  { producedByImage  = v; }

// ── Active tab tracking (Phase 1 — Tab Stability) ─────────────
// Single source of truth for which tab is currently active.
// Updated on every tab click; used by restoreActiveTab() to
// rebuild correct DOM state after any re-render or view toggle.
let _activeTabId = 'info-tab';

export function getActiveTabId()    { return _activeTabId; }
export function setActiveTabId(id)  { _activeTabId = id; }

/**
 * Restore the correct tab to "active" state in the DOM.
 * Safe to call any time the app is in table/tab view.
 * Does nothing when card view is active (tabs are hidden then).
 */
export function restoreActiveTab() {
    // Do not interfere while card view owns the screen
    const cardContainer = document.getElementById('cardViewContainer');
    if (cardContainer && cardContainer.style.display === 'block') return;

    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => {
        c.classList.remove('active');
        c.style.display = '';          // let CSS .active rule control visibility
    });

    const tabBtn = document.querySelector(`[data-tab="${_activeTabId}"]`);
    const tabEl  = document.getElementById(_activeTabId);
    if (tabBtn) tabBtn.classList.add('active');
    if (tabEl)  tabEl.classList.add('active');
}

// ── Custom section counter ────────────────────────────────────
let customSectionCounter = 0;

// ══════════════════════════════════════════════════════════════
//  DUTY & TASK MANAGEMENT
// ══════════════════════════════════════════════════════════════

export function addDuty() {
    AppState.dutyCount++;
    const dutyId = 'duty_' + AppState.dutyCount;
    AppState.taskCounts[dutyId] = 0;
    const dutyObj = { id: dutyId, title: '', tasks: [] };
    const cmd = makeAddDutyCmd(dutyObj);
    cmd.execute();
    pushCommand(cmd);
    Renderer.renderAll(StateManager.state);
}

export function removeDuty(dutyId) {
    const cmd = makeDeleteDutyCmd(dutyId);
    cmd.execute();
    pushCommand(cmd);
    Renderer.renderAll(StateManager.state);
}

export function addTask(dutyId) {
    AppState.taskCounts[dutyId] = (AppState.taskCounts[dutyId] || 0) + 1;
    const taskId = 'task_' + dutyId + '_' + AppState.taskCounts[dutyId];
    const taskObj = { id: taskId, text: '' };
    const cmd = makeAddTaskCmd(dutyId, taskObj);
    cmd.execute();
    pushCommand(cmd);
    Renderer.renderAll(StateManager.state);
}

export function removeTask(taskId) {
    const cmd = makeDeleteTaskCmd(taskId);
    cmd.execute();
    pushCommand(cmd);
    Renderer.renderAll(StateManager.state);
}

export function clearDuty(dutyId) {
    if (confirm('Are you sure you want to clear this duty and all its tasks?')) {
        const duty = AppState.duties.find(d => d.id === dutyId);
        if (duty) {
            duty.title = '';
            duty.tasks.forEach(t => { t.text = ''; });
        }
        saveToLocalStorage();
        updateHistoryButtons();
        Renderer.renderAll(StateManager.state);
        showStatus('Duty cleared! ✓', 'success');
    }
}

export function cvAddDuty() { addDuty(); }

// ── Card / Table view toggle ──────────────────────────────────
export function toggleCardView() {
    const cardContainer = document.getElementById('cardViewContainer');
    const tabContents   = document.querySelectorAll('.tab-content');
    const tabs          = document.querySelector('.tabs');

    AppState.isCardView = !AppState.isCardView;

    if (AppState.isCardView) {
        // Hide tabs; card container takes over full screen
        tabContents.forEach(tc => { tc.style.display = 'none'; });
        tabs.style.display = 'none';
        cardContainer.style.display = 'block';
    } else {
        // Return to tab view — restore whichever tab was active
        cardContainer.style.display = 'none';
        tabs.style.display = '';
        restoreActiveTab();          // ← Phase 1 fix: reactivate tracked tab
    }

    // Persist the user's preference so it survives page reloads and
    // project switches. Read back by _getPreferredView() in app.js.
    localStorage.setItem('preferredView', AppState.isCardView ? 'card' : 'table');

    Renderer.renderAll(StateManager.state);
}

// ══════════════════════════════════════════════════════════════
//  CLEAR ALL
// ══════════════════════════════════════════════════════════════

export function clearAll() {
    if (!confirm('Are you sure you want to clear ALL data? This cannot be undone!')) return;

    // Clear Chart Info fields
    ['dacumDate', 'producedFor', 'producedBy', 'occupationTitle', 'jobTitle']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

    // Clear images
    producedForImage = null;
    producedByImage  = null;
    _clearImagePreview('producedFor');
    _clearImagePreview('producedBy');

    // Build and push CLEAR_ALL command
    const cmd = makeClearAllCmd(AppState.duties, AppState.dutyCount, AppState.taskCounts);
    cmd.execute();
    pushCommand(cmd);

    // Switch back from card view if active
    if (AppState.isCardView) {
        AppState.isCardView = false;
        document.getElementById('cardViewContainer').style.display = 'none';
        document.querySelector('.tabs').style.display = '';
        document.querySelectorAll('.tab-content').forEach(tc => { tc.style.display = ''; });
    }

    // Reset Additional Info headings
    const headingDefaults = {
        knowledgeHeading: 'Knowledge Requirements',
        skillsHeading:    'Skills Requirements',
        behaviorsHeading: 'Worker Behaviors/Traits',
        toolsHeading:     'Tools, Equipment, Supplies and Materials',
        trendsHeading:    'Future Trends and Concerns',
        acronymsHeading:  'Acronyms',
        careerPathHeading:'Career Path'
    };
    Object.entries(headingDefaults).forEach(([id, text]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    });

    // Clear Additional Info textareas
    ['knowledgeInput','skillsInput','behaviorsInput','toolsInput',
     'trendsInput','acronymsInput','careerPathInput'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });

    // Clear custom sections
    const csc = document.getElementById('customSectionsContainer');
    if (csc) csc.innerHTML = '';
    customSectionCounter = 0;

    // Switch to Chart Info tab
    _activeTabId = 'info-tab';                         // ← Phase 1 fix
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('[data-tab="info-tab"]').classList.add('active');
    document.getElementById('info-tab').classList.add('active');

    saveToLocalStorage();
    updateHistoryButtons();
    Renderer.renderAll(StateManager.state);
    showStatus('All data cleared! ✓', 'success');
}

function _clearImagePreview(type) {
    const cap = type.charAt(0).toUpperCase() + type.slice(1);
    const preview = document.getElementById(type + 'ImagePreview');
    const removeBtn = document.getElementById('remove' + cap + 'Image');
    const fileInput = document.getElementById(type + 'ImageInput');
    if (preview)   { preview.innerHTML = '<span class="image-preview-placeholder">No image</span>'; preview.classList.remove('has-image'); }
    if (removeBtn) removeBtn.style.display = 'none';
    if (fileInput) fileInput.value = '';
}

// ══════════════════════════════════════════════════════════════
//  IMAGE UPLOAD
// ══════════════════════════════════════════════════════════════

export function handleImageUpload(event, imageType) {
    const file = event.target.files[0];
    if (!file) return;
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/bmp'];
    if (!validTypes.includes(file.type)) {
        showStatus('Please upload a valid image file (JPG, JPEG, PNG, or BMP)', 'error');
        return;
    }
    const reader = new FileReader();
    reader.onload = e => {
        const imageData = e.target.result;
        if (imageType === 'producedFor') producedForImage = imageData;
        else if (imageType === 'producedBy') producedByImage = imageData;
        const cap = imageType.charAt(0).toUpperCase() + imageType.slice(1);
        const preview = document.getElementById(imageType + 'ImagePreview');
        if (preview) { preview.innerHTML = `<img src="${imageData}" alt="${imageType} logo">`; preview.classList.add('has-image'); }
        const removeBtn = document.getElementById('remove' + cap + 'Image');
        if (removeBtn) removeBtn.style.display = 'inline-block';
        showStatus('Image uploaded successfully! ✓', 'success');
    };
    reader.readAsDataURL(file);
}

export function removeImage(imageType) {
    if (!confirm('Are you sure you want to remove this logo?')) return;
    if (imageType === 'producedFor') producedForImage = null;
    else if (imageType === 'producedBy') producedByImage = null;
    _clearImagePreview(imageType);
    showStatus('Image removed! ✓', 'success');
}

// ══════════════════════════════════════════════════════════════
//  INFO BOX
// ══════════════════════════════════════════════════════════════

export function toggleInfoBox() {
    const content = document.getElementById('infoBoxContent');
    const btn     = document.querySelector('.btn-toggle-info');
    if (content.style.display === 'none') {
        content.style.display = 'block';
        btn.textContent = 'Hide';
    } else {
        content.style.display = 'none';
        btn.textContent = 'Show';
    }
}

// ══════════════════════════════════════════════════════════════
//  SECTION MANAGEMENT (Additional Info)
// ══════════════════════════════════════════════════════════════

export function toggleEditHeading(headingId) {
    const heading    = document.getElementById(headingId);
    const isEditable = heading.getAttribute('contenteditable') === 'true';
    if (isEditable) {
        heading.setAttribute('contenteditable', 'false');
        heading.style.cursor = '';
        showStatus('Heading updated! ✓', 'success');
    } else {
        heading.setAttribute('contenteditable', 'true');
        heading.focus();
        const range = document.createRange();
        range.selectNodeContents(heading);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }
}

export function clearSection(inputId, headingId, defaultHeading) {
    if (!confirm('Are you sure you want to clear this section?')) return;
    const input = document.getElementById(inputId);
    const heading = document.getElementById(headingId);
    if (input)   input.value = '';
    if (heading) { heading.textContent = defaultHeading; heading.setAttribute('contenteditable', 'false'); }
    showStatus('Section cleared! ✓', 'success');
}

export function addCustomSection() {
    customSectionCounter++;
    const sectionId = `customSection${customSectionCounter}`;
    const headingId = `${sectionId}Heading`;
    const inputId   = `${sectionId}Input`;
    const container = document.getElementById('customSectionsContainer');

    const sectionDiv = document.createElement('div');
    sectionDiv.className = 'section-container';
    sectionDiv.id = sectionId;
    sectionDiv.innerHTML = `
        <div class="section-header-editable">
            <h3 id="${headingId}" contenteditable="false">Custom Section ${customSectionCounter}</h3>
            <div class="section-header-actions">
                <button class="btn-rename" onclick="window.toggleEditHeading('${headingId}')">✏️ Rename</button>
                <button class="btn-clear-section" onclick="window.clearSection('${inputId}', '${headingId}', 'Custom Section ${customSectionCounter}')">🗑️ Clear</button>
                <button class="btn-remove-section" onclick="window.removeCustomSection('${sectionId}')">❌ Remove</button>
            </div>
        </div>
        <textarea id="${inputId}" placeholder="Enter information for this custom section on separate lines"></textarea>
    `;
    container.appendChild(sectionDiv);
    showStatus('Custom section added! ✓', 'success');
}

export function removeCustomSection(sectionId) {
    if (!confirm('Are you sure you want to remove this section? This cannot be undone!')) return;
    const section = document.getElementById(sectionId);
    if (section) { section.remove(); showStatus('Section removed! ✓', 'success'); }
}

// ══════════════════════════════════════════════════════════════
//  SAVE / LOAD JSON
// ══════════════════════════════════════════════════════════════

export function saveToJSON() {
    try {
        const data = {
            version: '1.0',
            savedDate: new Date().toISOString(),
            chartInfo: {
                dacumDate:        document.getElementById('dacumDate').value,
                producedFor:      document.getElementById('producedFor').value,
                producedBy:       document.getElementById('producedBy').value,
                occupationTitle:  document.getElementById('occupationTitle').value,
                jobTitle:         document.getElementById('jobTitle').value,
                producedForImage,
                producedByImage
            },
            duties: AppState.duties.map(duty => ({
                duty:  duty.title,
                tasks: duty.tasks.map(t => t.text).filter(t => t.trim() !== '')
            })),
            additionalInfo: {
                headings: {
                    knowledge:  document.getElementById('knowledgeHeading').textContent,
                    skills:     document.getElementById('skillsHeading').textContent,
                    behaviors:  document.getElementById('behaviorsHeading').textContent,
                    tools:      document.getElementById('toolsHeading').textContent,
                    trends:     document.getElementById('trendsHeading').textContent,
                    acronyms:   document.getElementById('acronymsHeading').textContent,
                    careerPath: document.getElementById('careerPathHeading').textContent
                },
                knowledge:  document.getElementById('knowledgeInput').value,
                skills:     document.getElementById('skillsInput').value,
                behaviors:  document.getElementById('behaviorsInput').value,
                tools:      document.getElementById('toolsInput').value,
                trends:     document.getElementById('trendsInput').value,
                acronyms:   document.getElementById('acronymsInput').value,
                careerPath: document.getElementById('careerPathInput').value
            },
            customSections: []
        };

        document.querySelectorAll('#customSectionsContainer .section-container').forEach(div => {
            const h = div.querySelector('h3');
            const t = div.querySelector('textarea');
            if (h && t) data.customSections.push({ heading: h.textContent, content: t.value });
        });

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${(data.chartInfo.occupationTitle || 'DACUM_Chart').replace(/[^a-z0-9]/gi,'_')}_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        showStatus('Data saved successfully! ✓', 'success');
    } catch (err) {
        console.error('Error saving data:', err);
        showStatus('Error saving data: ' + err.message, 'error');
    }
}

export function loadFromJSON(event) {
    try {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => {
            try {
                const data = JSON.parse(e.target.result);

                // Chart Info
                if (data.chartInfo) {
                    ['dacumDate','producedFor','producedBy','occupationTitle','jobTitle']
                        .forEach(id => {
                            const el = document.getElementById(id);
                            if (el) el.value = data.chartInfo[id] || '';
                        });
                    if (data.chartInfo.producedForImage) {
                        producedForImage = data.chartInfo.producedForImage;
                        const p = document.getElementById('producedForImagePreview');
                        if (p) { p.innerHTML = `<img src="${producedForImage}" alt="Produced For logo">`; p.classList.add('has-image'); }
                        const r = document.getElementById('removeProducedForImage');
                        if (r) r.style.display = 'inline-block';
                    }
                    if (data.chartInfo.producedByImage) {
                        producedByImage = data.chartInfo.producedByImage;
                        const p = document.getElementById('producedByImagePreview');
                        if (p) { p.innerHTML = `<img src="${producedByImage}" alt="Produced By logo">`; p.classList.add('has-image'); }
                        const r = document.getElementById('removeProducedByImage');
                        if (r) r.style.display = 'inline-block';
                    }
                }

                // Rebuild duties
                AppState.duties = [];
                AppState.dutyCount = 0;
                AppState.taskCounts = {};
                if (Array.isArray(data.duties)) {
                    data.duties.forEach(dutyData => {
                        AppState.dutyCount++;
                        const dutyId = 'duty_' + AppState.dutyCount;
                        AppState.taskCounts[dutyId] = 0;
                        const tasks = (dutyData.tasks || []).map(text => {
                            AppState.taskCounts[dutyId]++;
                            return { id: `task_${dutyId}_${AppState.taskCounts[dutyId]}`, text };
                        });
                        AppState.duties.push({ id: dutyId, title: dutyData.duty || '', tasks });
                    });
                }

                // Additional Info
                if (data.additionalInfo) {
                    if (data.additionalInfo.headings) {
                        const hm = {
                            knowledge: 'knowledgeHeading', skills: 'skillsHeading',
                            behaviors: 'behaviorsHeading', tools: 'toolsHeading',
                            trends: 'trendsHeading', acronyms: 'acronymsHeading',
                            careerPath: 'careerPathHeading'
                        };
                        Object.entries(hm).forEach(([key, id]) => {
                            const el = document.getElementById(id);
                            if (el) el.textContent = data.additionalInfo.headings[key] || el.textContent;
                        });
                    }
                    const fm = {
                        knowledge: 'knowledgeInput', skills: 'skillsInput',
                        behaviors: 'behaviorsInput', tools: 'toolsInput',
                        trends: 'trendsInput', acronyms: 'acronymsInput',
                        careerPath: 'careerPathInput'
                    };
                    Object.entries(fm).forEach(([key, id]) => {
                        const el = document.getElementById(id);
                        if (el) el.value = data.additionalInfo[key] || '';
                    });
                }

                // Custom sections
                const csc = document.getElementById('customSectionsContainer');
                if (csc) csc.innerHTML = '';
                customSectionCounter = 0;
                if (Array.isArray(data.customSections)) {
                    data.customSections.forEach(section => {
                        addCustomSection();
                        const last = document.getElementById('customSectionsContainer').lastElementChild;
                        if (last) {
                            const h = last.querySelector('h3');
                            const t = last.querySelector('textarea');
                            if (h) h.textContent = section.heading;
                            if (t) t.value = section.content;
                        }
                    });
                }

                // Reset tabs, card view, history
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                document.querySelector('[data-tab="info-tab"]').classList.add('active');
                document.getElementById('info-tab').classList.add('active');

                AppState.isCardView = false;
                document.getElementById('cardViewContainer').style.display = 'none';
                StateManager.undoStack = [];
                StateManager.redoStack = [];
                saveToLocalStorage();
                updateHistoryButtons();
                Renderer.renderAll(StateManager.state);
                showStatus('Data loaded successfully! ✓', 'success');
                event.target.value = '';
            } catch (parseErr) {
                console.error('Error parsing JSON:', parseErr);
                showStatus('Error: Invalid JSON file', 'error');
            }
        };
        reader.readAsText(file);
    } catch (err) {
        console.error('Error loading file:', err);
        showStatus('Error loading file: ' + err.message, 'error');
    }
}

// ══════════════════════════════════════════════════════════════
//  EXPORT TO WORD (DOCX)
// ══════════════════════════════════════════════════════════════

export async function exportToWord() {
    try {
        if (typeof window.docx === 'undefined') {
            showStatus('Error: Word export library not loaded. Please refresh the page.', 'error');
            return;
        }

        const { Document, Paragraph, TextRun, Table, TableRow, TableCell,
                WidthType, AlignmentType, BorderStyle, Packer, PageBreak,
                convertInchesToTwip, ShadingType, TextDirection, ImageRun } = window.docx;

        const dacumDateValue = document.getElementById('dacumDate').value;
        let dacumDate = '';
        if (dacumDateValue) {
            const dateObj = new Date(dacumDateValue + 'T00:00:00');
            dacumDate = `${String(dateObj.getMonth()+1).padStart(2,'0')}/${String(dateObj.getDate()).padStart(2,'0')}/${dateObj.getFullYear()}`;
        }
        const producedFor     = document.getElementById('producedFor').value;
        const producedBy      = document.getElementById('producedBy').value;
        const occupationTitle = document.getElementById('occupationTitle').value;
        const jobTitle        = document.getElementById('jobTitle').value;

        if (!occupationTitle || !jobTitle) {
            showStatus('Please fill in at least the Occupation Title and Job Title', 'error');
            return;
        }
        showStatus('Generating Word document...', 'success');
        const children = [];

        // Title page
        children.push(new Paragraph({ children: [new TextRun({ text: `Occupation Title: ${occupationTitle}`, bold: true, size: 28 })], spacing: { after: 200 }, bidirectional: false }));
        children.push(new Paragraph({ children: [new TextRun({ text: `Job Title: ${jobTitle}`, bold: true, size: 28 })], spacing: { after: 200 }, bidirectional: false }));
        if (dacumDate) children.push(new Paragraph({ children: [new TextRun({ text: `DACUM Date: ${dacumDate}`, bold: true, size: 24 })], spacing: { after: 200 }, bidirectional: false }));

        if (producedFor) {
            children.push(new Paragraph({ children: [new TextRun({ text: `Produced For: ${producedFor}`, bold: true, size: 24 })], spacing: { after: 200 }, bidirectional: false }));
            if (producedForImage) {
                try {
                    const base64Data = producedForImage.split(',')[1];
                    children.push(new Paragraph({ children: [new ImageRun({ data: Uint8Array.from(atob(base64Data), c => c.charCodeAt(0)), transformation: { width: 94, height: 94 } })], alignment: AlignmentType.CENTER, spacing: { after: 200 } }));
                } catch(e) { console.error('Error adding Produced For image:', e); }
            }
        }

        if (producedBy) {
            children.push(new Paragraph({ children: [new TextRun({ text: `Produced By: ${producedBy}`, bold: true, size: 24 })], spacing: { after: 200 }, bidirectional: false }));
            if (producedByImage) {
                try {
                    const base64Data = producedByImage.split(',')[1];
                    children.push(new Paragraph({ children: [new ImageRun({ data: Uint8Array.from(atob(base64Data), c => c.charCodeAt(0)), transformation: { width: 94, height: 94 } })], alignment: AlignmentType.CENTER, spacing: { after: 400 } }));
                } catch(e) { console.error('Error adding Produced By image:', e); }
            }
        } else {
            children.push(new Paragraph({ spacing: { after: 200 } }));
        }

        // Duties and tasks — read from central AppState (works in any view)
        children.push(new Paragraph({ children: [new PageBreak(), new TextRun({ text: 'Duties and Tasks', bold: true, size: 28 })], alignment: AlignmentType.CENTER, spacing: { after: 300 }, bidirectional: false }));

        const duties = AppState.duties.map(d => ({
            duty:  d.title,
            tasks: d.tasks.map(t => t.text).filter(t => t.trim() !== '')
        }));

        duties.forEach((dutyData, dutyIndex) => {
            const letter = String.fromCharCode(65 + dutyIndex);
            const dutyLabel = `DUTY ${letter}: ${dutyData.duty}`;
            const tasksPerRow = 4;
            const numTaskRows = Math.ceil(dutyData.tasks.length / tasksPerRow);
            const tableRows = [];

            tableRows.push(new TableRow({ children: [new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: dutyLabel, bold: true, size: 24 })], bidirectional: false })], columnSpan: 4, shading: { fill: 'E8E8E8', type: ShadingType.SOLID }, width: { size: 100, type: WidthType.PERCENTAGE } })] }));

            for (let row = 0; row < numTaskRows; row++) {
                const rowCells = [];
                for (let col = 0; col < tasksPerRow; col++) {
                    const ti = row * tasksPerRow + col;
                    if (ti < dutyData.tasks.length) {
                        const tLabel = `Task ${letter}${ti + 1}: ${dutyData.tasks[ti]}`;
                        rowCells.push(new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: tLabel, size: 24 })], bidirectional: false })], width: { size: 25, type: WidthType.PERCENTAGE } }));
                    } else {
                        rowCells.push(new TableCell({ children: [new Paragraph('')], width: { size: 25, type: WidthType.PERCENTAGE } }));
                    }
                }
                tableRows.push(new TableRow({ children: rowCells }));
            }
            children.push(new Table({ width: { size: 9071, type: WidthType.DXA }, layout: 'fixed', rows: tableRows }));
            children.push(new Paragraph({ spacing: { after: 200 } }));
        });

        // Additional info
        children.push(new Paragraph({ children: [new PageBreak(), new TextRun({ text: 'Additional Information', bold: true, size: 24 })], spacing: { after: 300 }, bidirectional: false }));

        const additionalInfoSections = [
            { heading1: document.getElementById('knowledgeHeading').textContent, content1: document.getElementById('knowledgeInput').value.trim(), heading2: document.getElementById('behaviorsHeading').textContent, content2: document.getElementById('behaviorsInput').value.trim() },
            { heading1: document.getElementById('skillsHeading').textContent,    content1: document.getElementById('skillsInput').value.trim(),    heading2: '', content2: '' },
            { heading1: document.getElementById('toolsHeading').textContent,     content1: document.getElementById('toolsInput').value.trim(),     heading2: document.getElementById('trendsHeading').textContent, content2: document.getElementById('trendsInput').value.trim() },
            { heading1: document.getElementById('acronymsHeading').textContent,  content1: document.getElementById('acronymsInput').value.trim(),  heading2: document.getElementById('careerPathHeading').textContent, content2: document.getElementById('careerPathInput').value.trim() }
        ];

        const makeTextRuns = (text, size = 24) => text.split('\n').filter(l => l.trim()).map(l => new Paragraph({ children: [new TextRun({ text: l.trim().replace(/^[•\-*]\s*/, '• '), size })], bidirectional: false }));

        additionalInfoSections.forEach((section, index) => {
            if (index === 3 && section.content1) {
                const row = new TableRow({ children: [
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: section.heading1, bold: true, size: 24 })], bidirectional: false })], shading: { fill: 'E8E8E8', type: ShadingType.SOLID }, width: { size: 30, type: WidthType.PERCENTAGE } }),
                    new TableCell({ children: makeTextRuns(section.content1), width: { size: 70, type: WidthType.PERCENTAGE } })
                ] });
                children.push(new Table({ width: { size: 9071, type: WidthType.DXA }, layout: 'fixed', rows: [row] }));
                children.push(new Paragraph({ spacing: { after: 200 } }));
            } else if (section.content1 || section.content2) {
                const row = new TableRow({ children: [
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: section.heading1, bold: true, size: 24 })], bidirectional: false }), ...makeTextRuns(section.content1)], width: { size: 50, type: WidthType.PERCENTAGE } }),
                    new TableCell({ children: section.content2 ? [new Paragraph({ children: [new TextRun({ text: section.heading2, bold: true, size: 24 })], bidirectional: false }), ...makeTextRuns(section.content2)] : [new Paragraph('')], width: { size: 50, type: WidthType.PERCENTAGE } })
                ] });
                children.push(new Table({ width: { size: 9071, type: WidthType.DXA }, layout: 'fixed', rows: [row] }));
                children.push(new Paragraph({ spacing: { after: 200 } }));
            }
        });

        // Custom sections
        document.querySelectorAll('#customSectionsContainer .section-container').forEach(div => {
            const h = div.querySelector('h3');
            const t = div.querySelector('textarea');
            if (h && t && t.value.trim()) {
                const row = new TableRow({ children: [new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: h.textContent, bold: true, size: 24 })], bidirectional: false }), ...makeTextRuns(t.value)], columnSpan: 2, width: { size: 100, type: WidthType.PERCENTAGE } })] });
                children.push(new Table({ width: { size: 9071, type: WidthType.DXA }, layout: 'fixed', rows: [row] }));
                children.push(new Paragraph({ spacing: { after: 200 } }));
            }
        });

        const doc = new Document({ sections: [{ properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, children }] });
        const blob = await Packer.toBlob(doc);
        const url  = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${occupationTitle.replace(/[^a-z0-9]/gi,'_')}_${jobTitle.replace(/[^a-z0-9]/gi,'_')}_DACUM_Chart.docx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        showStatus('Word document exported successfully! ✓', 'success');
    } catch (err) {
        console.error('Error generating Word document:', err);
        showStatus('Error generating Word document: ' + err.message, 'error');
    }
}

// ══════════════════════════════════════════════════════════════
//  EXPORT TO PDF
// ══════════════════════════════════════════════════════════════

export function exportToPDF() {
    try {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

        const dacumDateInput        = document.getElementById('dacumDate');
        const producedForInput      = document.getElementById('producedFor');
        const producedByInput       = document.getElementById('producedBy');
        const occupationTitleInput  = document.getElementById('occupationTitle');
        const jobTitleInput         = document.getElementById('jobTitle');
        const toolsInput            = document.getElementById('toolsInput');
        const trendsInput           = document.getElementById('trendsInput');
        const acronymsInput         = document.getElementById('acronymsInput');

        let dacumDateFormatted = '';
        if (dacumDateInput.value) {
            const d = new Date(dacumDateInput.value + 'T00:00:00');
            dacumDateFormatted = `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}-${d.getFullYear()}`;
        }
        if (!occupationTitleInput.value || !jobTitleInput.value) {
            alert('Please fill in at least the Occupation Title and Job Title');
            return;
        }

        const margin    = 10;
        const pageWidth  = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        let yPos = margin + 10;

        // Title page
        pdf.setFontSize(18); pdf.setFont(undefined, 'bold');
        pdf.text(`DACUM Research Chart for ${occupationTitleInput.value}`, pageWidth / 2, yPos, { align: 'center' });
        yPos += 15;

        const leftColX = margin + 10, rightColX = pageWidth / 2 + 10;
        let leftY = yPos, rightY = yPos;

        if (producedForInput.value) {
            pdf.setFontSize(16); pdf.setFont(undefined, 'bold');
            pdf.text('Produced for', leftColX, leftY); leftY += 7;
            if (producedForImage) { try { pdf.addImage(producedForImage, 'JPEG', leftColX, leftY, 30, 20); leftY += 25; } catch(e) {} }
            pdf.setFont(undefined, 'normal'); pdf.setFontSize(14);
            pdf.text(producedForInput.value, leftColX, leftY); leftY += 15;
        }
        if (producedByInput.value) {
            pdf.setFontSize(16); pdf.setFont(undefined, 'bold');
            pdf.text('Produced by', leftColX, leftY); leftY += 7;
            if (producedByImage) { try { pdf.addImage(producedByImage, 'JPEG', leftColX, leftY, 30, 20); leftY += 25; } catch(e) {} }
            pdf.setFont(undefined, 'normal'); pdf.setFontSize(14);
            pdf.text(producedByInput.value, leftColX, leftY); leftY += 10;
        }
        if (dacumDateFormatted) { pdf.setFontSize(14); pdf.setFont(undefined, 'bold'); pdf.text(dacumDateFormatted, leftColX, leftY); }

        pdf.setFontSize(16); pdf.setFont(undefined, 'bold');
        pdf.text('Occupation:', rightColX, rightY); pdf.setFont(undefined, 'normal'); pdf.setFontSize(14);
        pdf.text(jobTitleInput.value, rightColX + 30, rightY); rightY += 7;
        pdf.setFontSize(16); pdf.setFont(undefined, 'bold');
        pdf.text('Job:', rightColX, rightY); pdf.setFont(undefined, 'normal'); pdf.setFontSize(14);
        pdf.text(occupationTitleInput.value, rightColX + 15, rightY);

        // DACUM chart grid — read from central AppState (works in any view)
        pdf.addPage('a4', 'landscape'); yPos = margin + 5;
        const duties = AppState.duties.map(d => ({
            duty:  d.title,
            tasks: d.tasks.map(t => t.text).filter(t => t.trim() !== '')
        }));
        if (duties.length === 0) { showStatus('Please add at least one duty with tasks', 'error'); return; }

        pdf.setFillColor(200,200,200);
        pdf.rect(margin, yPos, pageWidth-(margin*2), 8, 'FD');
        pdf.setFontSize(14); pdf.setFont(undefined, 'bold');
        pdf.text('DUTIES AND TASKS', pageWidth/2, yPos+5.5, { align: 'center' });
        yPos += 8;

        const maxCols = 4, chartWidth = pageWidth-(margin*2), colWidth = chartWidth/maxCols;
        let dutyIndex = 0;

        while (dutyIndex < duties.length) {
            const dtr = Math.min(maxCols, duties.length - dutyIndex);
            let maxHeaderHeight = 10;
            for (let col = 0; col < dtr; col++) {
                const x = margin + (col * colWidth);
                const letter = String.fromCharCode(65 + dutyIndex + col);
                pdf.rect(x, yPos, colWidth, 10, 'S');
                pdf.setFontSize(14); pdf.setFont(undefined, 'bold');
                const ht = `DUTY ${letter}: ${duties[dutyIndex+col].duty}`;
                const lines = pdf.splitTextToSize(ht, colWidth-3);
                maxHeaderHeight = Math.max(maxHeaderHeight, lines.length*4.5+3);
            }
            for (let col = 0; col < dtr; col++) {
                const x = margin + (col*colWidth);
                const letter = String.fromCharCode(65+dutyIndex+col);
                pdf.setFillColor(220,220,220); pdf.rect(x, yPos, colWidth, maxHeaderHeight, 'FD');
                pdf.setFontSize(14);
                const lines = pdf.splitTextToSize(`DUTY ${letter}: ${duties[dutyIndex+col].duty}`, colWidth-3);
                pdf.text(lines, x+1.5, yPos+4.5);
            }
            yPos += maxHeaderHeight;
            const maxTasks = Math.max(...duties.slice(dutyIndex, dutyIndex+dtr).map(d => d.tasks.length));
            for (let taskRow = 0; taskRow < maxTasks; taskRow++) {
                let rowHeight = 15;
                for (let col = 0; col < dtr; col++) {
                    if (duties[dutyIndex+col].tasks[taskRow]) {
                        pdf.setFontSize(12);
                        const letter = String.fromCharCode(65+dutyIndex+col);
                        const lines = pdf.splitTextToSize(`Task ${letter}${taskRow+1}:\n${duties[dutyIndex+col].tasks[taskRow]}`, colWidth-3);
                        rowHeight = Math.max(rowHeight, lines.length*4+3);
                    }
                }
                if (yPos + rowHeight > pageHeight - margin - 5) {
                    pdf.addPage('a4','landscape'); yPos = margin+5;
                    pdf.setFillColor(200,200,200); pdf.rect(margin,yPos,pageWidth-(margin*2),8,'FD');
                    pdf.setFontSize(14); pdf.setFont(undefined,'bold');
                    pdf.text('DUTIES AND TASKS (continued)', pageWidth/2, yPos+5.5, { align:'center' });
                    yPos += 8;
                }
                pdf.setFont(undefined,'normal'); pdf.setFontSize(12);
                for (let col = 0; col < dtr; col++) {
                    const x = margin+(col*colWidth);
                    pdf.rect(x, yPos, colWidth, rowHeight, 'S');
                    if (duties[dutyIndex+col].tasks[taskRow]) {
                        const letter = String.fromCharCode(65+dutyIndex+col);
                        const lines = pdf.splitTextToSize(`Task ${letter}${taskRow+1}:\n${duties[dutyIndex+col].tasks[taskRow]}`, colWidth-3);
                        pdf.text(lines, x+1.5, yPos+3);
                    }
                }
                yPos += rowHeight;
            }
            dutyIndex += dtr;
            if (dutyIndex < duties.length) {
                pdf.addPage('a4','landscape'); yPos = margin+5;
                pdf.setFillColor(200,200,200); pdf.rect(margin,yPos,pageWidth-(margin*2),8,'FD');
                pdf.setFontSize(14); pdf.setFont(undefined,'bold');
                pdf.text('DUTIES AND TASKS (continued)', pageWidth/2, yPos+5.5, { align:'center' });
                yPos += 8;
            }
        }

        // Knowledge / Skills / Behaviors
        const kt = document.getElementById('knowledgeInput').value.trim();
        const st = document.getElementById('skillsInput').value.trim();
        const bt = document.getElementById('behaviorsInput').value.trim();
        if (kt || st || bt) {
            pdf.addPage('a4','landscape'); yPos = margin+5;
            pdf.setFontSize(14); pdf.setFont(undefined,'bold');
            pdf.text('General Knowledge and Skills', pageWidth/2, yPos, { align:'center' }); yPos += 8;
            const tw = (pageWidth-(margin*2))/3;
            let c1Y=yPos, c2Y=yPos, c3Y=yPos;
            const pdfSection = (text, heading, x, yRef) => {
                pdf.setFontSize(14); pdf.setFont(undefined,'bold'); pdf.text(heading, x, yRef); yRef += 6;
                pdf.setFontSize(12); pdf.setFont(undefined,'normal');
                text.split('\n').filter(l=>l.trim()).forEach(item => { pdf.text(item.trim().replace(/^[•\-*]\s*/,''), x, yRef); yRef += 4.5; });
                return yRef;
            };
            if (kt) c1Y = pdfSection(kt, document.getElementById('knowledgeHeading').textContent, margin, c1Y);
            if (st) c2Y = pdfSection(st, document.getElementById('skillsHeading').textContent, margin+tw, c2Y);
            if (bt) c3Y = pdfSection(bt, document.getElementById('behaviorsHeading').textContent, margin+tw*2, c3Y);
        }

        // Tools & Trends
        const tools  = toolsInput.value.trim()  ? toolsInput.value.split('\n').filter(l=>l.trim())  : [];
        const trends = trendsInput.value.trim() ? trendsInput.value.split('\n').filter(l=>l.trim()) : [];
        if (tools.length || trends.length) {
            pdf.addPage('a4','landscape'); yPos = margin+5;
            const hw = (pageWidth-(margin*2)-5)/2;
            let lY=yPos, rY=yPos;
            if (tools.length) {
                pdf.setFontSize(14); pdf.setFont(undefined,'bold'); pdf.text(document.getElementById('toolsHeading').textContent, margin, lY); lY += 6;
                pdf.setFontSize(12); pdf.setFont(undefined,'normal');
                tools.forEach(t => { pdf.text(t.trim().replace(/^[•\-*]\s*/,''), margin, lY); lY += 4.5; });
            }
            if (trends.length) {
                pdf.setFontSize(14); pdf.setFont(undefined,'bold'); pdf.text(document.getElementById('trendsHeading').textContent, margin+hw+5, rY); rY += 6;
                pdf.setFontSize(12); pdf.setFont(undefined,'normal');
                trends.forEach(t => { pdf.text(t.trim().replace(/^[•\-*]\s*/,''), margin+hw+5, rY); rY += 4.5; });
            }
        }

        // Acronyms
        if (acronymsInput.value.trim()) {
            pdf.addPage('a4','landscape'); yPos = margin+5;
            pdf.setFontSize(14); pdf.setFont(undefined,'bold'); pdf.text(document.getElementById('acronymsHeading').textContent, margin, yPos); yPos += 6;
            pdf.setFontSize(12); pdf.setFont(undefined,'normal');
            acronymsInput.value.split('\n').filter(l=>l.trim()).forEach(a => { pdf.text(a.trim().replace(/^[•\-*]\s*/,''), margin, yPos); yPos += 4.5; });
        }

        // Career Path
        const cpi = document.getElementById('careerPathInput');
        if (cpi && cpi.value.trim()) {
            pdf.addPage('a4','landscape'); yPos = margin+5;
            pdf.setFontSize(14); pdf.setFont(undefined,'bold'); pdf.text(document.getElementById('careerPathHeading').textContent, margin, yPos); yPos += 6;
            pdf.setFontSize(12); pdf.setFont(undefined,'normal');
            cpi.value.split('\n').filter(l=>l.trim()).forEach(item => { pdf.text(item.trim().replace(/^[•\-*]\s*/,''), margin, yPos); yPos += 4.5; });
        }

        // Custom sections
        document.querySelectorAll('#customSectionsContainer .section-container').forEach(div => {
            const h = div.querySelector('h3'), t = div.querySelector('textarea');
            if (h && t && t.value.trim()) {
                pdf.addPage('a4','landscape'); yPos = margin+5;
                pdf.setFontSize(14); pdf.setFont(undefined,'bold'); pdf.text(h.textContent, margin, yPos); yPos += 6;
                pdf.setFontSize(12); pdf.setFont(undefined,'normal');
                t.value.split('\n').filter(l=>l.trim()).forEach(item => { pdf.text(item.trim().replace(/^[•\-*]\s*/,''), margin, yPos); yPos += 4.5; });
            }
        });

        pdf.save(`${occupationTitleInput.value}_${jobTitleInput.value}_DACUM_Chart.pdf`);
        showStatus('PDF exported successfully! ✓', 'success');
    } catch (err) {
        console.error('Error generating PDF:', err);
        showStatus('Error generating PDF: ' + err.message, 'error');
    }
}

// ══════════════════════════════════════════════════════════════
//  FILE ENGINE — PROJECT EXPORT / IMPORT
//  Thin wrappers that call fileEngine.js, keeping all engine
//  logic in one place while exposing clean public functions that
//  can be bound to window.* in app.js.
// ══════════════════════════════════════════════════════════════

/**
 * Export the currently active project as a versioned .json file.
 * The projectId argument is supplied by app.js when it binds
 * this function to window.exportProjectFile.
 *
 * @param {string} projectId — id of the project to export
 */
export function exportProjectFile(projectId) {
    exportProject(projectId);
}

/**
 * Handle the <input type="file"> change event for project import.
 * Passes the selected File to the fileEngine and resets the input
 * so the same file can be re-imported if needed.
 *
 * @param {Event} event — native change event from the file input
 */
export function importProjectFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    importProject(file);
    // Reset the input so the same file path can trigger onchange again
    event.target.value = '';
}

// ══════════════════════════════════════════════════════════════
//  EVENT BINDER
// ══════════════════════════════════════════════════════════════

export const EventBinder = {
    init() {
        // ── Tab navigation ──────────────────────────────────────
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', function() {
                const tabId = this.getAttribute('data-tab');
                _activeTabId = tabId;                          // ← Phase 1 fix: track active tab
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                this.classList.add('active');
                document.getElementById(tabId).classList.add('active');
                if (tabId === 'duties-tab' && AppState.duties.length === 0) {
                    AppState.dutyCount++;
                    const initDutyId = 'duty_' + AppState.dutyCount;
                    AppState.taskCounts[initDutyId] = 1;
                    AppState.duties.push({ id: initDutyId, title: '', tasks: [{ id: 'task_' + initDutyId + '_1', text: '' }] });
                    saveToLocalStorage();
                    updateHistoryButtons();
                    Renderer.renderAll(StateManager.state);
                }
            });
        });

        // ── Keyboard shortcuts ──────────────────────────────────
        document.addEventListener('keydown', e => {
            const tag = document.activeElement ? document.activeElement.tagName : '';
            if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement.getAttribute('contenteditable') === 'true') return;
            if (e.ctrlKey && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo(); }
            if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); }
        });

        // ── Close snapshot panel on outside click ───────────────
        document.addEventListener('click', e => {
            const panel = document.getElementById('snapshotPanel');
            const fp    = document.getElementById('floatingPanel');
            if (panel && panel.style.display === 'block' && !panel.contains(e.target) && !(fp && fp.contains(e.target))) {
                panel.style.display = 'none';
            }
        });

        // ── Library check ───────────────────────────────────────
        window.addEventListener('load', () => {
            setTimeout(() => {
                if (typeof window.docx === 'undefined') console.error('Warning: docx library failed to load');
                else console.log('docx library loaded successfully');
            }, 1000);
        });
    }
};
