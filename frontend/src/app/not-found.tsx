import Link from "next/link";
import { buttonPrimary, pageWrap } from "@/components/ui";

export default function NotFound() {
  return (
    <div className={`${pageWrap} py-16`}>
      <h1 className="font-display text-[clamp(2.2rem,5vw,3.2rem)] leading-tight font-black text-plum">
        We couldn’t find that page
      </h1>
      <p className="mt-4 max-w-[50ch] text-[1.1rem] text-body">
        The class may have been renamed or taken off the calendar.
      </p>
      <Link href="/classes" className={`${buttonPrimary} mt-8`}>
        See all classes
      </Link>
    </div>
  );
}
