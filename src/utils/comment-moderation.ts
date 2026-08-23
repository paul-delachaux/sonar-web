import { BANNED_WORDS } from './bannedWords';

/** Normalise leetspeak, accents et ponctuation pour limiter les contournements. */
export function foldForModeration(value: string): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[0]/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/[3]/g, 'e')
    .replace(/[4@]/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/[7]/g, 't')
    .replace(/\*/g, '')
    .replace(/[^a-z]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compact(value: string): string {
  return foldForModeration(value).replace(/ /g, '');
}

const foldedBanned = [...new Set(BANNED_WORDS.map(foldForModeration).filter(Boolean))];
const compactBanned = [
  ...new Set(
    foldedBanned
      .map((word) => word.replace(/ /g, ''))
      .filter((word) => word.length >= 5)
  ),
];
const shortBanned = [
  ...new Set(
    foldedBanned
      .map((word) => word.replace(/ /g, ''))
      .filter((word) => word.length > 0 && word.length < 5)
  ),
];

export function containsBannedPhrase(text: string): boolean {
  const spaced = ` ${foldForModeration(text)} `;
  const packed = compact(text);
  if (shortBanned.some((word) => spaced.includes(` ${word} `))) return true;
  if (compactBanned.some((word) => packed.includes(word))) return true;
  return false;
}

type ModerationResult = {
  blocked: boolean;
  reason: 'banned' | null;
};

export async function moderateComment(text: string): Promise<ModerationResult> {
  if (containsBannedPhrase(text)) {
    return { blocked: true, reason: 'banned' };
  }
  return { blocked: false, reason: null };
}
