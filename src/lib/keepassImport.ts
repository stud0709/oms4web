import { OMS4WEB_REF } from './constants';

export interface RawKeePassEntry {
  id: string;
  rawTitle: string;
  rawUsername: string;
  rawPassword: string;
  protectPassword: boolean;
  rawUrl: string;
  rawNotes: string;
  rawCustomFields: {
    id: string;
    label: string;
    value: string;
    protectInMemory: boolean;
  }[];
  hashtags: string[];
  createdAt: Date;
  updatedAt: Date;
  history: {
    timestamp: Date;
    data: RawKeePassEntry;
  }[];
}

/**
 * Parses a Base64-encoded KeePass 16-byte UUID into a standard 8-4-4-4-12 UUID string.
 */
export function parseKeePassUuid(b64: string): string {
  if (!b64) return crypto.randomUUID();
  try {
    const binary = atob(b64.trim());
    if (binary.length === 16) {
      const hex = Array.from(binary, c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
    }
  } catch {
    // fallback to generating a random UUID if Base64 decoding fails
  }
  return crypto.randomUUID();
}

const KEEPASS_REF_REGEX = /\{REF:([^@]+)@([^:]+):([^}]+)\}/gi;

function findTargetRawEntry(searchIn: string, searchText: string, entries: RawKeePassEntry[]): RawKeePassEntry | undefined {
  const code = searchIn.toUpperCase();
  const lowerText = searchText.toLowerCase();
  const cleanUuid = searchText.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

  if (code === 'I') {
    return entries.find(e => e.id.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === cleanUuid || e.id.toLowerCase() === lowerText);
  }
  if (code === 'T') {
    return entries.find(e => e.rawTitle === searchText) || entries.find(e => e.rawTitle.toLowerCase() === lowerText);
  }
  if (code === 'U') {
    return entries.find(e => e.rawUsername === searchText) || entries.find(e => e.rawUsername.toLowerCase() === lowerText);
  }
  if (code === 'P') {
    return entries.find(e => e.rawPassword === searchText);
  }
  if (code === 'A') {
    return entries.find(e => e.rawUrl === searchText) || entries.find(e => e.rawUrl.toLowerCase() === lowerText);
  }
  if (code === 'N') {
    return entries.find(e => e.rawNotes === searchText) || entries.find(e => e.rawNotes.toLowerCase() === lowerText);
  }
  if (code.startsWith('O:') || code === 'O') {
    const label = code.startsWith('O:') ? searchIn.slice(2).trim().toLowerCase() : '';
    return entries.find(e => e.rawCustomFields.some(cf => {
      if (label && cf.label.toLowerCase() !== label) return false;
      return cf.value === searchText || cf.value.toLowerCase() === lowerText;
    }));
  }
  return undefined;
}

function getTargetPropertyPath(wantedField: string): string | null {
  const w = wantedField.toUpperCase();
  if (w === 'P') return 'password';
  if (w === 'U') return 'username';
  if (w === 'T') return 'title';
  if (w === 'A') return 'url';
  if (w === 'N') return 'notes';
  if (w.startsWith('O:')) {
    const label = wantedField.slice(2).trim();
    return `customFields[?(@.label=='${label}')].value`;
  }
  if (w === 'O') {
    return 'customFields[0].value';
  }
  return null;
}

function getRawFieldValue(wantedField: string, entry: RawKeePassEntry): string {
  const w = wantedField.toUpperCase();
  if (w === 'P') return entry.rawPassword;
  if (w === 'U') return entry.rawUsername;
  if (w === 'T') return entry.rawTitle;
  if (w === 'A') return entry.rawUrl;
  if (w === 'N') return entry.rawNotes;
  if (w.startsWith('O:')) {
    const label = wantedField.slice(2).trim().toLowerCase();
    const cf = entry.rawCustomFields.find(f => f.label.toLowerCase() === label);
    return cf?.value ?? '';
  }
  if (w === 'O') {
    return entry.rawCustomFields[0]?.value ?? '';
  }
  return '';
}

/**
 * Converts KeePass {REF:...} field references to oms4web:// JSONPath references.
 * If the reference cannot be resolved (e.g. target deleted or missing), it is left as {REF:...} as is.
 */
export function convertKeePassValue(
  val: string,
  allEntries: RawKeePassEntry[],
  visited: Set<string> = new Set()
): string {
  if (!val || !val.includes('{REF:')) return val;

  // Standalone check: exact single reference
  const standaloneMatch = /^\{REF:([^@]+)@([^:]+):([^}]+)\}$/i.exec(val.trim());
  if (standaloneMatch) {
    const wantedField = standaloneMatch[1].trim();
    const searchIn = standaloneMatch[2].trim();
    const searchText = standaloneMatch[3].trim();

    const target = findTargetRawEntry(searchIn, searchText, allEntries);
    if (!target) {
      // If the referenced entry cannot be resolved, leave the {REF:...} as is
      return val;
    }

    const propPath = getTargetPropertyPath(wantedField);
    if (!propPath) {
      return val;
    }

    return `${OMS4WEB_REF}$.[?(@.id=='${target.id}')].${propPath}`;
  }

  // Composite / embedded references: resolve placeholders to raw values
  return val.replace(KEEPASS_REF_REGEX, (match, wantedFieldRaw, searchInRaw, searchTextRaw) => {
    const wantedField = wantedFieldRaw.trim();
    const searchIn = searchInRaw.trim();
    const searchText = searchTextRaw.trim();

    const target = findTargetRawEntry(searchIn, searchText, allEntries);
    if (!target) {
      // Leave unresolved reference as is
      return match;
    }

    const cycleKey = `${target.id}:${wantedField.toUpperCase()}`;
    if (visited.has(cycleKey)) {
      return match;
    }

    const nextVisited = new Set(visited);
    nextVisited.add(cycleKey);

    const rawVal = getRawFieldValue(wantedField, target);
    return convertKeePassValue(rawVal, allEntries, nextVisited);
  });
}
