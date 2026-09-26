/**
 * AudioKing Local Storage Utility Helpers
 * Provides type-safe JSON serialization/deserialization and fallback defaults.
 */

export function getStorage(key, defaultValue = null) {
  if (typeof localStorage === 'undefined') return defaultValue;
  try {
    const item = localStorage.getItem(key);
    if (item === null) return defaultValue;
    return JSON.parse(item);
  } catch (error) {
    console.warn(`[Storage] Error reading key "${key}":`, error);
    return defaultValue;
  }
}

export function setStorage(key, value) {
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error(`[Storage] Error persisting key "${key}":`, error);
    return false;
  }
}

export function removeStorage(key) {
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.removeItem(key);
    return true;
  } catch (error) {
    console.error(`[Storage] Error removing key "${key}":`, error);
    return false;
  }
}
