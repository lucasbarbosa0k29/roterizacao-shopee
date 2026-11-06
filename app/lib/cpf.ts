export function normalizeCpf(value: string) {
  return value.replace(/\D/g, "");
}

// Check digits only: this is not identity verification or an official registry lookup.
export function isValidCpf(value: string) {
  const digits = normalizeCpf(value);
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  for (const length of [9, 10]) {
    const sum = [...digits.slice(0, length)].reduce((total, digit, i) => total + Number(digit) * (length + 1 - i), 0);
    const remainder = (sum * 10) % 11;
    if (Number(digits[length]) !== (remainder === 10 ? 0 : remainder)) return false;
  }
  return true;
}
