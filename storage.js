// ============================================================
// storage.js — LocalStorage Persistence Layer
// ============================================================
import { AppState, StateManager } from './state.js';

const STORAGE_KEY = 'dacumAppState';

/**
 * Persist the current AppState to localStorage.
 * Called after every state-mutating operation.
 */
export function saveToLocalStorage() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(AppState));
    } catch (e) {
        console.warn('LocalStorage save failed:', e);
    }
}

/**
 * Restore AppState from localStorage on startup.
 * Returns true if data was found and applied, false otherwise.
 */
export function loadFromLocalStorage() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            Object.assign(AppState, parsed);
            return true;
        }
    } catch (e) {
        console.warn('LocalStorage load failed:', e);
    }
    return false;
}
