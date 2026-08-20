export type DefinitionEntry = {
  term?: string;
  definition?: string;
  term_en?: string;
  definition_en?: string;
};

export function normalizeDefinitions(raw: unknown): DefinitionEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const term = String(item?.term || '').trim();
      const definition = String(item?.definition || '').trim();
      const termEn = String(item?.term_en || '').trim();
      const definitionEn = String(item?.definition_en || '').trim();
      if (!(term || termEn) || !(definition || definitionEn)) return null;
      return {
        term: term || undefined,
        definition: definition || undefined,
        term_en: termEn || undefined,
        definition_en: definitionEn || undefined,
      };
    })
    .filter((item): item is DefinitionEntry => item !== null)
    .sort((a, b) => {
      const lenA = Math.max(a.term?.length || 0, a.term_en?.length || 0);
      const lenB = Math.max(b.term?.length || 0, b.term_en?.length || 0);
      return lenB - lenA;
    });
}
