// very light heuristics + override via input metadata
export type LocalePref = 'ar'|'ary'|'fr'|'en'|'es'|'auto';

export function detectLocale(text: string, hint?: LocalePref): LocalePref {
  if (hint && hint !== 'auto') return hint;

  const s = (text || '').trim();
  if (!s) return 'en';

  // naive heuristics
  const hasArabic = /[\u0600-\u06FF]/.test(s);
  if (hasArabic) {
    // Darija often mixes Arabic script & Latin; let caller force ary if needed
    return 'ar';
  }

  const looksFrench = /[éèêàçùîôûïë]/i.test(s) || /\b(le|la|les|des|de|pour|avec)\b/i.test(s);
  if (looksFrench) return 'fr';

  const looksSpanish = /\b(el|la|de|para|con|gracias)\b/i.test(s);
  if (looksSpanish) return 'es';

  return 'en';
}

// prefer explicit Darija if store or customer lang says so
export function preferDarija(storeLang?: string, customerLang?: string): boolean {
  const l = `${(customerLang||'').toLowerCase()} ${(storeLang||'').toLowerCase()}`;
  return /\b(ary|darija|moroccan|ma)\b/.test(l);
}

export function localeTag(loc: LocalePref): string {
  // map to BCP-47 (Darija → 'ary')
  if (loc === 'ary') return 'ary';
  return loc;
}
