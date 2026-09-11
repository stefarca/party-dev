// Match codes: 6 characters from an unambiguous alphabet (no I, O, 0, 1 —
// characters that are easy to mis-key or mis-read when read aloud in an
// office). Pure and unit-testable; no crypto, no I/O.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

export const MATCH_CODE_RE = new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`);

export function generateMatchCode(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    const index = Math.floor(random() * ALPHABET.length);
    code += ALPHABET[index];
  }
  return code;
}

export function normalizeMatchCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, "");
}
