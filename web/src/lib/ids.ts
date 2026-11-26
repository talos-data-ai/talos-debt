/**
 * Checks on numbers people type in setup, the same as the API's
 * (api/src/intake/normalize.ts and api/src/routes/onboarding.ts), so a typo
 * is caught at once and explained in the reader's language.
 */

/** A Saudi national ID or iqama number passes its check digit (Luhn). */
export function saudiIdOk(id: string): boolean {
  if (!/^[12]\d{9}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const x = Number(id[i]);
    sum += i % 2 === 0 ? Math.floor((x * 2) / 10) + ((x * 2) % 10) : x;
  }
  return sum % 10 === 0;
}

/** A Saudi IBAN: SA and 22 digits, and the international check (mod 97) passes. Uses BigInt, never a float. */
export function ibanOk(iban: string): boolean {
  if (!/^SA\d{22}$/.test(iban)) return false;
  const moved = `${iban.slice(4)}${iban.slice(0, 4)}`.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  return BigInt(moved) % 97n === 1n;
}

/** A Saudi VAT number: 15 digits, starting and ending with 3. */
export const vatOk = (v: string) => /^3\d{13}3$/.test(v);
