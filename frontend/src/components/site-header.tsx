import Image from "next/image";
import Link from "next/link";
import { AccountLink } from "./account";
import { bookBead, buttonBook, pageWrap } from "./ui";

const NAV = [
  { href: "/classes", label: "Classes" },
  { href: "/calendar", label: "Calendar" },
  { href: "/classes?type=kids", label: "Kids" },
  { href: "/contact", label: "Contact" },
];

/**
 * "Book a class" is the call to action on every page. It is the only button
 * with a gold bead, which sets it apart from the other purple buttons while
 * keeping gold off the cream paper (ADR-041).
 */
export function SiteHeader() {
  return (
    <header>
      <div
        className={`${pageWrap} flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-4`}
      >
        <Link href="/" className="shrink-0 rounded-full">
          <Image
            src="/brand/logo-full.png"
            alt="Studio Rags, Fabric Fun — home"
            width={549}
            height={507}
            priority
            className="h-14 w-auto"
          />
        </Link>

        <nav
          aria-label="Main"
          className="order-last w-full sm:order-none sm:w-auto"
        >
          <ul className="-mx-3 flex flex-wrap sm:mx-0 sm:gap-2">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="inline-flex min-h-11 items-center rounded-full px-3 font-semibold text-purple hover:bg-lilac"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          <AccountLink />
          <Link href="/classes" className={buttonBook}>
            Book a class
            <span aria-hidden="true" className={bookBead}>
              <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-5 transition-transform group-hover:translate-x-0.5"
              >
                <path d="M4 10h11.5M11 5.5 15.5 10 11 14.5" />
              </svg>
            </span>
          </Link>
        </div>
      </div>
      <div className="motif" aria-hidden="true" />
    </header>
  );
}
