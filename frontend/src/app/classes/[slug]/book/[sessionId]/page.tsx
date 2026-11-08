import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiUnavailable } from "@/components/api-unavailable";
import { BookingForm } from "@/components/booking-form";
import { BookingSteps, ClassSummary, pageHeading } from "@/components/booking-parts";
import { PriceTag, priceNote } from "@/components/class-card";
import { buttonPrimary, pageWrap, textLink } from "@/components/ui";
import { getWorkshop, getWorkshopSessions } from "@/lib/catalogue";

type Props = {
  params: Promise<{ slug: string; sessionId: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const result = await getWorkshop(slug);
  return {
    title: result.ok ? `Book ${result.data.title}` : "Book a class",
    robots: { index: false },
  };
}

/**
 * Step 1 of booking: one date of one class. The class and date come from the
 * same cached catalogue reads as the class page (ADR-034), so this page shows
 * at once; the form inside checks the live count and the sign-in itself.
 */
export default async function BookPage({ params, searchParams }: Props) {
  const [{ slug, sessionId }, { from }] = await Promise.all([params, searchParams]);
  const [workshop, sessions] = await Promise.all([getWorkshop(slug), getWorkshopSessions(slug)]);

  if (!workshop.ok && workshop.reason === "not-found") notFound();
  if (!workshop.ok || !sessions.ok) {
    return (
      <div className={`${pageWrap} py-12`}>
        <ApiUnavailable what="this class" />
      </div>
    );
  }

  const w = workshop.data;
  // The list holds every future date still on sale, full ones included
  // (ADR-037). A date missing from it has started, finished or been cancelled.
  const date = sessions.data.find((s) => s.id === sessionId);
  const classPage = `/classes/${encodeURIComponent(w.slug)}`;

  return (
    <div className={`${pageWrap} py-8 sm:py-10`}>
      {/* booking-flow: the action bar's container, from the top of the
          column down (globals.css). */}
      <div className="booking-flow mx-auto flex w-full max-w-2xl flex-col gap-6">
        <p>
          <Link href={classPage} className={`${textLink} inline-flex min-h-11 items-center`}>
            ← {w.title}
          </Link>
        </p>

        {date ? (
          <>
            <BookingSteps current={0} />
            <h1 className={pageHeading}>Book your places</h1>
            <ClassSummary
              title={w.title}
              startsAt={date.startsAt}
              endsAt={date.endsAt}
              deliveryMode={w.deliveryMode}
              location={date.location}
            >
              <p className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-muted">Price</span>
                <PriceTag cents={date.priceCents} note={priceNote(w) ?? "a place"} />
              </p>
            </ClassSummary>
            <BookingForm
              workshop={{
                slug: w.slug,
                title: w.title,
                productType: w.productType,
                deliveryMode: w.deliveryMode,
                minAge: w.minAge,
                maxAge: w.maxAge,
              }}
              date={{
                id: date.id,
                startsAt: date.startsAt,
                priceCents: date.priceCents,
                seatsLeft: date.seatsLeft,
              }}
              from={typeof from === "string" ? from : undefined}
            />
          </>
        ) : (
          <section className="rounded-[var(--radius-card)] border-2 border-line bg-card p-6 sm:p-8">
            <h1 className="font-display text-[1.8rem] leading-tight font-semibold text-plum">
              This date isn’t on sale
            </h1>
            <p className="mt-2 text-body">
              It may have already taken place, or Rehana has had to cancel it. The class has other
              dates you can book.
            </p>
            <Link href={`${classPage}#dates-heading`} className={`${buttonPrimary} mt-6`}>
              See the dates for {w.title}
            </Link>
          </section>
        )}
      </div>
    </div>
  );
}
