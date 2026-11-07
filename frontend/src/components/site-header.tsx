import Image from "next/image";
import Link from "next/link";
import { buttonPrimary, pageWrap } from "./ui";

const NAV = [
  { href: "/classes", label: "Classes" },
  { href: "/calendar", label: "Calendar" },
  { href: "/classes?type=kids", label: "Kids" },
  { href: "/contact", label: "Contact" },
];

/**
 * The approved mockup shows a gold "Book a class" here, on the cream header.
 * Gold on paper is 2.19:1, so the header uses the purple button; gold appears
 * on the purple sections instead (ADR-035).
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

        <Link href="/classes" className={buttonPrimary}>
          Book a class
        </Link>
      </div>
      <div className="motif" aria-hidden="true" />
    </header>
  );
}
