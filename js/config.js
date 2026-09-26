/**
 * AudioKing Centralized Client Configuration
 * Single source of truth for all client-editable contact numbers, keys, and brand variables.
 */
export const AUDIOKING_CONFIG = {
  brandName: "AudioKing",
  tagline: "Pro Audio • Musical Instruments • Studio Gear",
  expertPhone: "+91 88793 93743",
  whatsappNumber: "+91 88793 93743",
  supportEmail: "support@audioking.in",
  businessHours: "Monday – Saturday: 10:00 AM – 8:00 PM IST",
  currency: "INR",
  currencySymbol: "₹",
  cartStorageKey: "audioking_cart",
  userStorageKey: "audioking_user",
  addressStorageKey: "audioking_saved_address",
  address: "D-101, Bonanza Industrial Estate, Ashok Chakravarty Road, Kandivali East, Mumbai - 400101"
};

// Backwards-compatible named exports
export const AUDIOKING_EXPERT_PHONE = AUDIOKING_CONFIG.expertPhone;
export const AUDIOKING_WHATSAPP_NUMBER = AUDIOKING_CONFIG.whatsappNumber;
export const AUDIOKING_EMAIL = AUDIOKING_CONFIG.supportEmail;
export const AUDIOKING_HOURS = AUDIOKING_CONFIG.businessHours;
export const AUDIOKING_BRAND_NAME = AUDIOKING_CONFIG.brandName;
export const AUDIOKING_TAGLINE = AUDIOKING_CONFIG.tagline;
export const AUDIOKING_ADDRESS = AUDIOKING_CONFIG.address;

// Legacy re-export of formatINR from formatters
export { formatINR } from './utils/formatters.js';
