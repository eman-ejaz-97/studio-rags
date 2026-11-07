import Link from "next/link";
import { pageWrap } from "./ui";

const LINKS = [
  { href: "/classes", label: "All classes", prefetch: undefined },
  { href: "/calendar", label: "Calendar", prefetch: undefined },
  { href: "/contact", label: "Contact Rehana", prefetch: undefined },
  // The status page wakes the database; a prefetch would do it on every page.
  { href: "/status", label: "Test site status", prefetch: false },
];

export function SiteFooter() {
  return (
    <footer className="on-dark mt-auto bg-night py-10 text-night-ink">
      <div
        className={`${pageWrap} flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between`}
      >
        <div>
          <p className="font-display text-xl font-semibold text-white">
            Studio Rags
          </p>
          <p>Textile art workshops in Sefton Park, Adelaide</p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-col gap-1 sm:items-end">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  prefetch={l.prefetch}
                  className="inline-flex min-h-11 items-center underline decoration-1 underline-offset-4 hover:text-white"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
