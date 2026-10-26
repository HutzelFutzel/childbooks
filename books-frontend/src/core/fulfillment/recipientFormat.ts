/**
 * Format checks for the recipient fields the printer refuses outright when
 * malformed: the phone the carrier calls, and the customs tax id three
 * countries demand. Lulu only rejects these when the print job is created —
 * after payment — so checkout and the server's checkout route both ask first.
 *
 * Deliberately loose where the real rules vary (phone numbering plans), strict
 * only where the id carries its own check digits and a typo can be proven.
 */

/** Why a phone number can't be right, or null when it may be. */
export function phoneProblem(raw: string): string | null {
  const phone = raw.trim().replace(/\s*(?:ext\.?|x)\s*\d+$/i, "");
  if (!phone) return "Enter a phone number.";
  if (!/^\+?[\d\s().\-/]+$/.test(phone)) return "Use digits only (spaces, dashes and a leading + are fine).";
  const digits = phone.replace(/\D/g, "").length;
  if (digits < 7) return "That phone number looks too short.";
  if (digits > 15) return "That phone number looks too long.";
  return null;
}

/** Why a recipient tax id can't be valid for `country`, or null when it may be. */
export function taxIdProblem(country: string, raw: string): string | null {
  const value = raw.trim().toUpperCase();
  if (!value) return null;
  switch (country.trim().toUpperCase()) {
    case "BR":
      return brazilTaxIdProblem(value);
    case "CL":
      return rutProblem(value);
    case "MX":
      return /^[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}$/.test(value.replace(/[\s-]/g, ""))
        ? null
        : "An RFC is 12 or 13 characters, like ABCD800101XY1.";
    default:
      return null;
  }
}

/** CPF (11 digits) or CNPJ (14 characters; alphanumeric since July 2026). */
function brazilTaxIdProblem(value: string): string | null {
  const compact = value.replace(/[\s./-]/g, "");
  if (/^\d{11}$/.test(compact)) {
    return validCpf(compact) ? null : "That CPF doesn't add up — please check the digits.";
  }
  if (/^[A-Z\d]{12}\d{2}$/.test(compact)) {
    return validCnpj(compact) ? null : "That CNPJ doesn't add up — please check it.";
  }
  return "Enter an 11-digit CPF or a 14-character CNPJ.";
}

function validCpf(cpf: string): boolean {
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  const digits = [...cpf].map(Number);
  const check = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += digits[i] * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return check(9) === digits[9] && check(10) === digits[10];
}

function validCnpj(cnpj: string): boolean {
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  // Letters count as their char code minus 48, which leaves digits as themselves.
  const values = [...cnpj].map((c) => c.charCodeAt(0) - 48);
  const check = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += values[i] * (((len - 1 - i) % 8) + 2);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return check(12) === values[12] && check(13) === values[13];
}

function rutProblem(value: string): string | null {
  const compact = value.replace(/[\s.-]/g, "");
  const m = compact.match(/^(\d{7,8})([\dK])$/);
  if (!m) return "A RUT looks like 12.345.678-5.";
  let sum = 0;
  let factor = 2;
  for (let i = m[1].length - 1; i >= 0; i--) {
    sum += Number(m[1][i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const r = 11 - (sum % 11);
  const expected = r === 11 ? "0" : r === 10 ? "K" : String(r);
  return expected === m[2] ? null : "That RUT's check digit doesn't match — please check it.";
}
