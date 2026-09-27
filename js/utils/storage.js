/**
 * AudioKing Local Storage Utility Helpers
 * Provides type-safe JSON serialization/deserialization and fallback defaults.
 */

export function getStorage(key, defaultValue = null) {
  if (typeof localStorage === 'undefined') return defaultValue;
  try {
    const item = localStorage.getItem(key);
    if (item === null) return defaultValue;
    try {
      return JSON.parse(item);
    } catch {
      // If item is a plain string (like a session token), return it directly
      return item;
    }
  } catch (error) {
    return defaultValue;
  }
}

export function setStorage(key, value) {
  if (typeof localStorage === 'undefined') return false;
  try {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    localStorage.setItem(key, serialized);
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
