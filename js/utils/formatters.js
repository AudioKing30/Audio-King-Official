/**
 * AudioKing Formatting Utility Functions
 * Handles currency formatting (INR), order ID generation, and date formatting.
 */
import { AUDIOKING_CONFIG } from '../config.js';

export function formatINR(amount) {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return `${AUDIOKING_CONFIG.currencySymbol}0`;
  }
  const rounded = Math.round(Number(amount));
  return `${AUDIOKING_CONFIG.currencySymbol}${rounded.toLocaleString('en-IN')}`;
}

export function generateOrderId() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const dateStr = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `AK-${dateStr}-${rand}`;
}

export function formatDate(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}
