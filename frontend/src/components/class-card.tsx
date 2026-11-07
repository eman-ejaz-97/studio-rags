import Image from "next/image";
import Link from "next/link";
import { formatDay, formatTime } from "@/lib/adelaide";
import type { WorkshopCard } from "@/lib/catalogue-types";
import { formatDuration, formatPrice, formatSeatsLeft } from "@/lib/format";

/** "3 hours · in the studio", "2 hours · live on Zoom", "90 minutes · ages 7–15" */
export function classMeta(w: WorkshopCard): string {
  const where =
    w.minAge !== null && w.maxAge !== null
      ? `ages ${w.minAge}–${w.maxAge}`
      : w.deliveryMode === "ONLINE"
        ? "live on Zoom"
        : "in the studio";
  return `${formatDuration(w.durationMinutes)} · ${where}`;
}

export function PriceTag({
  cents,
  note,
}: {
  cents: number;
  note?: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-1 rounded-full bg-purple px-4 py-1 font-bold text-white">
      {formatPrice(cents)}
      {note && <span className="text-base font-semibold text-mist">{note}</span>}
    </span>
  );
}

/** Kids class: one ticket covers the child and their adult (ADR-033). */
export function priceNote(w: Pick<WorkshopCard, "requiresAccompanyingAdult">) {
  return w.requiresAccompanyingAdult ? "child + adult" : undefined;
}

/**
 * The whole card is one link, named by its title. The rest of the card is
 * description, so a screen reader hears the title first, not "link, image".
 */
export function ClassCard({
  workshop,
  headingLevel = 3,
}: {
  workshop: WorkshopCard;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const next = workshop.nextSession;

  return (
    <article className="relative flex flex-col overflow-hidden rounded-[var(--radius-card)] border-2 border-line bg-card transition-shadow hover:shadow-lg has-[a:focus-visible]:outline-3 has-[a:focus-visible]:outline-offset-4 has-[a:focus-visible]:outline-purple">
      <div className="aspect-[5/4] bg-lilac">
        {workshop.heroImage && (
          <Image
            src={workshop.heroImage.url}
            alt={workshop.heroImage.alt}
            width={workshop.heroImage.width ?? 940}
            height={workshop.heroImage.height ?? 470}
            sizes="(min-width: 1024px) 360px, (min-width: 640px) 45vw, 100vw"
            className="h-full w-full object-cover"
          />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <Heading className="font-display text-[1.3rem] leading-tight font-semibold text-plum">
          <Link
            href={`/classes/${workshop.slug}`}
            className="after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none"
          >
            {workshop.title}
          </Link>
        </Heading>
        <p className="flex-1 text-muted">{workshop.summary}</p>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <PriceTag cents={workshop.priceCents} note={priceNote(workshop)} />
          <span className="text-base text-subtle">
            {classMeta(workshop)}
          </span>
        </div>
        <p className="rounded-xl bg-sand px-3 py-2 text-base font-semibold text-sand-ink">
          {next ? (
            <>
              Next:{" "}
              <time dateTime={next.startsAt}>
                {formatDay(next.startsAt)}, {formatTime(next.startsAt)}
              </time>
              {next.seatsLeft <= 3 && ` · ${formatSeatsLeft(next.seatsLeft)}`}
            </>
          ) : (
            "New dates coming soon"
          )}
        </p>
      </div>
    </article>
  );
}
