/**
 * AudioKing Strict Content Security & Profanity Guard
 * Automatically scans incoming payloads for abusive language, vulgar slang,
 * and malicious script injection patterns.
 */

const BLOCKED_WORDS = [
  'muh me le', 'muh mein le', 'muhmele', 'lund', 'lauda', 'lawda', 'loda',
  'chutiya', 'choot', 'bhenchod', 'behenchod', 'madarchod', 'gand', 'gaand',
  'tatte', 'bhosadi', 'bhosdike', 'harami', 'randi', 'saala', 'kamina',
  'fuck', 'fucker', 'motherfucker', 'asshole', 'bitch', 'dick', 'pussy',
  'bastard', 'cunt', 'nigger', 'cock', 'boobs'
];

const INJECTION_PATTERNS = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /javascript\s*:/gi,
  /onload\s*=/gi,
  /onerror\s*=/gi,
  /onclick\s*=/gi,
  /<iframe/gi
];

/**
 * Checks a string or object for blocked vulgarities or injection patterns.
 * Returns { clean: boolean, matched: string | null }
 */
function scanContent(value) {
  if (value == null) return { clean: true };

  let textToScan = '';
  if (typeof value === 'string') {
    textToScan = value;
  } else if (typeof value === 'object') {
    textToScan = JSON.stringify(value);
  } else {
    textToScan = String(value);
  }

  const normalized = textToScan.toLowerCase().replace(/[\s\-_.]+/g, ' ');

  // 1. Check for vulgar words
  for (const word of BLOCKED_WORDS) {
    const regex = new RegExp(`(^|\\b|\\s)${word.replace(/\s+/g, '[\\s\\-_.]*')}($|\\b|\\s)`, 'i');
    if (regex.test(normalized) || normalized.includes(word)) {
      return { clean: false, matched: word, reason: 'Inappropriate or vulgar language detected.' };
    }
  }

  // 2. Check for script injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(textToScan)) {
      return { clean: false, matched: 'script_injection', reason: 'Disallowed HTML script or event handler detected.' };
    }
  }

  return { clean: true };
}

/**
 * Express middleware to validate request body for profanity/injection
 */
function contentSecurityGuard(fieldsToValidate = []) {
  return (req, res, next) => {
    const body = req.body || {};
    
    // If specific fields given, validate them; otherwise validate entire body
    if (fieldsToValidate.length > 0) {
      for (const field of fieldsToValidate) {
        if (body[field] != null) {
          const check = scanContent(body[field]);
          if (!check.clean) {
            console.warn(`[SECURITY BLOCKED] Field "${field}" rejected: ${check.reason} (matched: ${check.matched}) from IP ${req.ip}`);
            return res.status(400).json({
              error: `Security Check Failed: ${check.reason}`,
              code: 'CONTENT_SECURITY_VIOLATION'
            });
          }
        }
      }
    } else {
      const check = scanContent(body);
      if (!check.clean) {
        console.warn(`[SECURITY BLOCKED] Payload rejected: ${check.reason} (matched: ${check.matched}) from IP ${req.ip}`);
        return res.status(400).json({
          error: `Security Check Failed: ${check.reason}`,
          code: 'CONTENT_SECURITY_VIOLATION'
        });
      }
    }

    next();
  };
}

module.exports = {
  scanContent,
  contentSecurityGuard,
  BLOCKED_WORDS
};
