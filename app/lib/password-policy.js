export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;

/** @param {string} password @returns {string | null} */
export function passwordPolicyError(password) {
  if (password.length < PASSWORD_MIN_LENGTH) return `A nova senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) return `A senha é muito longa (máximo de ${PASSWORD_MAX_BYTES} bytes).`;
  if (/^\s+$/.test(password)) return "A senha não pode conter somente espaços.";
  return null;
}
