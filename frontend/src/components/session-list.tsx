"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatLongDay, formatTime, formatTimeRange } from "@/lib/adelaide";
import { bookPath } from "@/lib/booking";
import type { DeliveryMode, SessionView } from "@/lib/catalogue-types";
import { formatPrice, formatSeatsLeft } from "@/lib/format";
import { DateTile } from "./booking-parts";
import { buttonPrimary } from "./ui";

/**
 * The dates for one class. The server renders them from a cache up to a
 * minute old; on arrival the browser asks the API again with no cache at all,
 * so the places-left count is the live one. If that refresh fails, the
 * server's numbers stay on screen rather than an error.
 */
export function SessionList({
  slug,
  title,
  basePriceCents,
  deliveryMode,
  initial,
}: {
  slug: string;
  title: string;
  basePriceCents: number;
  deliveryMode: DeliveryMode;
  initial: SessionView[];
}) {
  const [sessions, setSessions] = useState(initial);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/v1/workshops/${encodeURIComponent(slug)}/sessions`, {
      cache: "no-store",
      signal: controller.signal,
      headers: { accept: "application/json" },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { sessions: SessionView[] } | null) => {
        if (body) setSessions(body.sessions);
      })
      .catch(() => {
        // Aborted on unmount, or the API is asleep: keep the server's list.
      });
    return () => controller.abort();
  }, [slug]);

  if (sessions.length === 0) {
    return (
      <p className="rounded-[var(--radius-card)] border-2 border-line bg-card p-5 text-muted">
        No dates are on sale right now. New dates are added often —{" "}
        <Link
          href={`/contact?class=${encodeURIComponent(slug)}`}
          className="font-semibold text-purple underline underline-offset-4"
        >
          ask Rehana about the next one
        </Link>
        .
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {sessions.map((s) => {
        const when = `${formatLongDay(s.startsAt)}, ${formatTime(s.startsAt)}`;
        return (
          <li
            key={s.id}
            className="flex flex-col gap-4 rounded-[var(--radius-card)] border-2 border-line bg-card p-5 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex gap-4">
              <DateTile iso={s.startsAt} />
              <div className="flex flex-col items-start gap-1">
                <p className="font-semibold text-plum">
                  <time dateTime={s.startsAt}>{formatLongDay(s.startsAt)}</time>
                </p>
                <p className="text-muted">
                  {formatTimeRange(s.startsAt, s.endsAt)} ·{" "}
                  {deliveryMode === "ONLINE"
                    ? "Live on Zoom"
                    : (s.location ?? "Studio Rags, Sefton Park")}
                  {s.priceCents !== basePriceCents &&
                    ` · ${formatPrice(s.priceCents)}`}
                </p>
                <span
                  className={
                    s.isFull
                      ? "rounded-full bg-lilac px-3 py-0.5 font-semibold text-muted"
                      : "rounded-full bg-sand px-3 py-0.5 font-semibold text-sand-ink"
                  }
                >
                  {formatSeatsLeft(s.seatsLeft)}
                </span>
              </div>
            </div>
            {/* A full date stays listed, in words, with nothing to press
                (ADR-037). The visible words start the link's name, and the
                date completes it for anyone hearing a list of these. */}
            {!s.isFull && (
              <Link
                href={bookPath(slug, s.id)}
                className={`${buttonPrimary} w-full shrink-0 sm:w-auto`}
              >
                Book this date
                <span className="sr-only">
                  : {title}, {when}
                </span>
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
