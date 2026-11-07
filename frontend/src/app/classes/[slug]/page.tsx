import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiUnavailable } from "@/components/api-unavailable";
import { PriceTag, priceNote } from "@/components/class-card";
import { SessionList } from "@/components/session-list";
import { pageWrap, textLink } from "@/components/ui";
import { getWorkshop, getWorkshopSessions } from "@/lib/catalogue";
import type { WorkshopDetail } from "@/lib/catalogue-types";
import { formatDuration, formatPrice } from "@/lib/format";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const result = await getWorkshop(slug);
  if (!result.ok) {
    return {
      title:
        result.reason === "not-found" ? "Class not found" : "Class unavailable",
    };
  }
  return { title: result.data.title, description: result.data.summary };
}

export default async function ClassPage({ params }: Props) {
  const { slug } = await params;
  // Both start at once; fetch() de-duplicates the one generateMetadata made.
  const [workshop, sessions] = await Promise.all([
    getWorkshop(slug),
    getWorkshopSessions(slug),
  ]);

  if (!workshop.ok && workshop.reason === "not-found") notFound();
  if (!workshop.ok) {
    return (
      <div className={`${pageWrap} py-12`}>
        <ApiUnavailable what="this class" />
      </div>
    );
  }

  const w = workshop.data;
  const hero = w.heroImage;

  return (
    <article className={`${pageWrap} py-10`}>
      <p className="mb-2">
        <Link
          href="/classes"
          className={`${textLink} inline-flex min-h-11 items-center`}
        >
          ← All classes
        </Link>
      </p>

      <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <h1 className="font-display text-[clamp(2.2rem,5vw,3.3rem)] leading-tight font-black text-plum">
            {w.title}
          </h1>
          <p className="mt-4 max-w-[60ch] text-[1.15rem] text-body">
            {w.summary}
          </p>
          {w.description !== w.summary && (
            <p className="mt-4 max-w-[60ch] whitespace-pre-line text-body">
              {w.description}
            </p>
          )}
          <Facts workshop={w} />
        </div>

        {hero && (
          <Image
            src={hero.url}
            alt={hero.alt}
            width={hero.width ?? 940}
            height={hero.height ?? 470}
            priority
            sizes="(min-width: 1024px) 45vw, 100vw"
            className="w-full rounded-[var(--radius-card)] object-cover"
          />
        )}
      </div>

      <section aria-labelledby="dates-heading" className="mt-14">
        <h2
          id="dates-heading"
          className="font-display text-[2rem] font-semibold text-plum"
        >
          Upcoming dates
        </h2>
        <p className="mt-2 mb-6 max-w-[62ch] rounded-xl bg-lilac p-4 text-purple">
          <strong>Online booking opens soon.</strong> Until then, choose a date
          and send Rehana a message, and she will hold your place.
        </p>
        {sessions.ok ? (
          <SessionList
            slug={w.slug}
            title={w.title}
            basePriceCents={w.priceCents}
            deliveryMode={w.deliveryMode}
            initial={sessions.data}
          />
        ) : (
          <ApiUnavailable what="the dates" />
        )}
      </section>

      {w.cancellation && (
        <section aria-labelledby="cancel-heading" className="mt-14 max-w-[62ch]">
          <h2
            id="cancel-heading"
            className="font-display text-[1.6rem] font-semibold text-plum"
          >
            If you need to cancel
          </h2>
          {/* Her published policy (SPEC § 5, ADR-014a). The late-cancellation
              line stays neutral on cash or voucher until § 10 item 4 is answered. */}
          <ul className="mt-3 list-disc space-y-2 pl-6 text-body">
            <li>
              More than {w.cancellation.cutoffBusinessDays} business days before
              the class: a full refund, or a credit voucher to use within{" "}
              {w.cancellation.voucherValidityMonths} months. You choose.
            </li>
            <li>
              {w.cancellation.cutoffBusinessDays} business days or less: a
              cancellation fee of{" "}
              {formatPrice(w.cancellation.lateFeeCentsPerPerson)} per person
              applies.
            </li>
            <li>If you don’t come on the day, the class can’t be refunded.</li>
            <li>
              If Rehana has to cancel, you choose a full refund, a new date or a
              gift card.
            </li>
          </ul>
        </section>
      )}
    </article>
  );
}

function Facts({ workshop: w }: { workshop: WorkshopDetail }) {
  const rows: Array<[string, React.ReactNode]> = [
    ["Price", <PriceTag key="p" cents={w.priceCents} note={priceNote(w)} />],
    ["Length", formatDuration(w.durationMinutes)],
    [
      "Where",
      w.deliveryMode === "ONLINE"
        ? "Live on Zoom, from home. The link is emailed once you have booked."
        : "Studio Rags, Sefton Park, Adelaide",
    ],
  ];
  if (w.minAge !== null && w.maxAge !== null) {
    rows.push(["Ages", `${w.minAge} to ${w.maxAge}`]);
  }
  if (w.requiresAccompanyingAdult) {
    rows.push([
      "Who comes",
      "Each child comes with one adult. One ticket covers you both.",
    ]);
  }
  if (w.skillLevel) rows.push(["Level", w.skillLevel]);
  if (w.whatsIncluded) rows.push(["Included", w.whatsIncluded]);
  if (w.whatToBring) rows.push(["Bring", w.whatToBring]);

  return (
    <dl className="mt-8 divide-y-2 divide-line rounded-[var(--radius-card)] border-2 border-line bg-card">
      {rows.map(([label, value]) => (
        <div key={label} className="grid gap-1 px-5 py-4 sm:grid-cols-[8rem_1fr]">
          <dt className="font-semibold text-plum">{label}</dt>
          <dd className="text-body">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
