export type RequiredDomField = {
  elementId: string;
  valid: boolean;
  message: string;
};

type ValidatableElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function clearFieldError(elementId: string) {
  const element = document.getElementById(elementId) as ValidatableElement | null;
  element?.setCustomValidity("");
  element?.removeAttribute("aria-invalid");
  document.getElementById(`${elementId}-required-error`)?.remove();
}

function showFieldError(field: RequiredDomField) {
  const element = document.getElementById(field.elementId) as ValidatableElement | null;
  if (!element) return;

  element.setCustomValidity(field.message);
  element.setAttribute("aria-invalid", "true");
  const feedback = document.createElement("p");
  feedback.id = `${field.elementId}-required-error`;
  feedback.className = "mt-1.5 text-xs font-medium text-[var(--color-danger)]";
  feedback.textContent = field.message;
  element.insertAdjacentElement("afterend", feedback);

  const clear = () => clearFieldError(field.elementId);
  element.addEventListener("input", clear, { once: true });
  element.addEventListener("change", clear, { once: true });
}

export function validateRequiredDomFields(fields: RequiredDomField[]) {
  fields.forEach((field) => clearFieldError(field.elementId));
  const invalidFields = fields.filter((field) => !field.valid);
  invalidFields.forEach(showFieldError);
  const firstInvalid = invalidFields[0];
  if (!firstInvalid) return true;

  const element = document.getElementById(firstInvalid.elementId) as ValidatableElement | null;
  if (!element) return false;
  element.scrollIntoView({ behavior: "smooth", block: "center" });
  element.focus({ preventScroll: true });
  element.reportValidity();
  return false;
}
