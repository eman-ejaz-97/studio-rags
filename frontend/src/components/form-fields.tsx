/**
 * The form parts every form on the site shares, so a field, its hint and its
 * error look and behave the same everywhere. Labels are always visible, and an
 * error is a sentence beside its field, never a colour alone.
 */

export function fieldClass(invalid: boolean) {
  return `min-h-12 w-full rounded-[var(--radius-field)] border-2 bg-field px-4 py-3 text-ink focus:border-purple focus:shadow-[0_0_0_3px_var(--color-focus-glow)] focus:outline-none ${
    invalid ? "border-error-ink" : "border-field-line"
  }`;
}

export function FieldError({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return (
    <p id={id} className="flex gap-2 font-semibold text-error-ink">
      <span aria-hidden="true">!</span>
      {error}
    </p>
  );
}

export function TextField({
  name,
  label,
  hint,
  error,
  ...input
}: {
  name: string;
  label: string;
  hint?: string;
  error?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name">) {
  const hintId = hint ? `${name}-hint` : undefined;
  const errorId = error ? `${name}-error` : undefined;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={name} className="font-semibold text-plum">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-subtle">
          {hint}
        </p>
      )}
      <input
        id={name}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        className={fieldClass(Boolean(error))}
        {...input}
      />
      <FieldError id={`${name}-error`} error={error} />
    </div>
  );
}

/** The whole-form message above the fields: a failed send, or a refusal. */
export function FormAlert({
  message,
  details,
  children,
}: {
  message: string;
  details?: string[];
  children?: React.ReactNode;
}) {
  return (
    <div
      role="alert"
      className="rounded-[var(--radius-field)] border-2 border-error-line bg-error-bg p-4 font-semibold text-error-ink"
    >
      <p>
        <span aria-hidden="true">! </span>
        {message}
      </p>
      {details && details.length > 0 && (
        <ul className="mt-2 list-disc pl-6 font-normal">
          {details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
      {children}
    </div>
  );
}

/** A quiet confirmation, such as "your password has been changed". */
export function FormNotice({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-[var(--radius-field)] border-2 border-ok-line bg-ok-bg p-4 text-ok-ink"
    >
      {children}
    </div>
  );
}
