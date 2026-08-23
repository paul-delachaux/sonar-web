export const PASSWORD_MIN_LENGTH = 8;

export type PasswordChecks = {
  minLength: boolean;
  lower: boolean;
  upper: boolean;
  digit: boolean;
};

export function getPasswordChecks(password: string): PasswordChecks {
  return {
    minLength: password.length >= PASSWORD_MIN_LENGTH,
    lower: /[a-z]/.test(password),
    upper: /[A-Z]/.test(password),
    digit: /\d/.test(password),
  };
}

export function isStrongPassword(password: string): boolean {
  const checks = getPasswordChecks(password);
  return checks.minLength && checks.lower && checks.upper && checks.digit;
}

export function isValidEmail(email: string): boolean {
  const value = email.trim();
  if (!value || value.length > 254) return false;
  return /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/.test(
    value
  );
}

export function bindPasswordChecklist(input: HTMLInputElement | null, root: HTMLElement | null): void {
  if (!input || !root) return;

  const update = () => {
    const checks = getPasswordChecks(input.value);
    root.querySelectorAll<HTMLElement>('[data-check]').forEach((el) => {
      const key = el.getAttribute('data-check') as keyof PasswordChecks | null;
      if (!key || !(key in checks)) return;
      el.classList.toggle('is-met', checks[key]);
    });
  };

  input.addEventListener('input', update);
  update();
}

export function isEmailNotConfirmedError(message: string | undefined): boolean {
  const raw = (message || '').toLowerCase();
  return raw.includes('email not confirmed') || raw.includes('not confirmed');
}

export function isAuthRateLimitError(message: string | undefined): boolean {
  return (message || '').toLowerCase().includes('rate limit');
}
