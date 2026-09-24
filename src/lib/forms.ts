// Utilidades compartidas por los formularios de acceso (login, registro, recuperar).

export const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function setError(input: HTMLElement, errorEl: HTMLElement, message: string) {
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
  input.setAttribute('aria-invalid', 'true');
}

export function clearError(input: HTMLElement, errorEl: HTMLElement) {
  errorEl.classList.add('hidden');
  errorEl.textContent = '';
  input.removeAttribute('aria-invalid');
}

export function isShowingError(errorEl: HTMLElement) {
  return !errorEl.classList.contains('hidden');
}

/** Valida un correo y pinta el error correspondiente. */
export function validateEmailField(input: HTMLInputElement, errorEl: HTMLElement): boolean {
  const value = input.value.trim();
  if (!value) {
    setError(input, errorEl, 'Ingresa tu correo electrónico.');
    return false;
  }
  if (!emailPattern.test(value)) {
    setError(input, errorEl, 'Ingresa un correo válido, por ejemplo nombre@correo.com.');
    return false;
  }
  clearError(input, errorEl);
  return true;
}

/** Botones de mostrar/ocultar contraseña: [data-toggle-password="id-del-input"]. */
export function bindPasswordToggles(root: ParentNode = document) {
  root.querySelectorAll<HTMLButtonElement>('[data-toggle-password]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-toggle-password');
      const input = targetId ? (document.getElementById(targetId) as HTMLInputElement | null) : null;
      if (!input) return;

      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      btn.querySelector('.eye-open')?.classList.toggle('hidden', reveal);
      btn.querySelector('.eye-closed')?.classList.toggle('hidden', !reveal);
      btn.setAttribute('aria-label', reveal ? 'Ocultar contraseña' : 'Mostrar contraseña');
      btn.setAttribute('aria-pressed', String(reveal));
    });
  });
}

/**
 * Estado de envío: bloquea el botón y muestra el texto de carga.
 * Mientras no exista backend, resuelve tras una breve espera.
 */
export function withSubmitting(button: HTMLButtonElement, task: () => Promise<void> | void) {
  const label = button.querySelector<HTMLElement>('[data-label]');
  const loading = button.querySelector<HTMLElement>('[data-loading]');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  label?.classList.add('hidden');
  loading?.classList.remove('hidden');
  loading?.classList.add('inline-flex');

  return new Promise<void>((resolve) => setTimeout(resolve, 900))
    .then(task)
    .finally(() => {
      button.removeAttribute('aria-busy');
      loading?.classList.add('hidden');
      loading?.classList.remove('inline-flex');
      label?.classList.remove('hidden');
    });
}
