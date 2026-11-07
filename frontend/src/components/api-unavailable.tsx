import Link from "next/link";
import { textLink } from "./ui";

/**
 * Shown when the API did not answer in time. On staging that almost always
 * means Render's free server is waking up, which takes about a minute.
 */
export function ApiUnavailable({ what }: { what: string }) {
  return (
    <div
      role="status"
      className="rounded-[var(--radius-card)] border-2 border-line bg-card p-6"
    >
      <p className="font-display text-xl font-semibold text-plum">
        We couldn’t load {what} just now
      </p>
      <p className="mt-2 text-muted">
        The booking system is starting up. Please wait a minute and refresh the
        page, or{" "}
        <Link href="/contact" className={textLink}>
          send Rehana a message
        </Link>
        .
      </p>
    </div>
  );
}
