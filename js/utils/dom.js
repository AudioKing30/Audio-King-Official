/**
 * AudioKing Lightweight DOM Helpers
 * Clean query selectors, event binding, and element generation.
 */

export const $ = (selector, parent = document) => parent.querySelector(selector);
export const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

export function on(element, event, handler, options = false) {
  if (!element) return;
  element.addEventListener(event, handler, options);
}

export function off(element, event, handler) {
  if (!element) return;
  element.removeEventListener(event, handler);
}

export function createElement(tag, className = '', innerHTML = '', attrs = {}) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (innerHTML) el.innerHTML = innerHTML;
  Object.entries(attrs).forEach(([key, val]) => el.setAttribute(key, val));
  return el;
}
