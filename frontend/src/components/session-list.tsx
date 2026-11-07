"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatLongDay, formatTime } from "@/lib/adelaide";
import type { DeliveryMode, SessionView } from "@/lib/catalogue-types";
import { formatPrice, formatSeatsLeft } from "@/lib/format";
import { buttonOutline } from "./ui";

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
            className="flex flex-col gap-3 rounded-[var(--radius-card)] border-2 border-line bg-card p-5 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex flex-col gap-1">
              <p className="font-semibold text-plum">
                <time dateTime={s.startsAt}>{formatLongDay(s.startsAt)}</time>
              </p>
              <p className="text-muted">
                {formatTime(s.startsAt)} – {formatTime(s.endsAt)} ·{" "}
                {deliveryMode === "ONLINE"
                  ? "Live on Zoom"
                  : (s.location ?? "Studio Rags, Sefton Park")}
                {s.priceCents !== basePriceCents &&
                  ` · ${formatPrice(s.priceCents)}`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={
                  s.isFull
                    ? "rounded-full bg-lilac px-3 py-1 font-semibold text-muted"
                    : "rounded-full bg-sand px-3 py-1 font-semibold text-sand-ink"
                }
              >
                {formatSeatsLeft(s.seatsLeft)}
              </span>
              {!s.isFull && (
                <Link
                  href={`/contact?class=${encodeURIComponent(slug)}&date=${encodeURIComponent(s.startsAt)}`}
                  className={buttonOutline}
                  aria-label={`Ask about ${title} on ${when}`}
                >
                  Ask about this date
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
