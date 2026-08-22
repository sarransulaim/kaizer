/**
 * Phone numbers arrive from WhatsApp, the Google Form, and typed by hand, in
 * every format a human can invent. They're normalized to digits before storage
 * so that "(732) 555-0134", "732-555-0134" and "7325550134" are the same
 * customer — phone is the identity key for lookup.
 */

/** Strip everything except digits, and drop a leading US country code. */
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, '')

  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1)
  }
  return digits
}

/** 7325550134 -> "(732) 555-0134". Anything non-standard is returned as-is. */
export function formatPhone(phone: string): string {
  const digits = normalizePhone(phone)

  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return phone
}

/** US numbers are 10 digits after normalization. */
export function isValidPhone(input: string): boolean {
  return normalizePhone(input).length === 10
}

/** Digits-only form suitable for a `tel:` link. */
export function toTelHref(phone: string): string {
  return `tel:+1${normalizePhone(phone)}`
}
