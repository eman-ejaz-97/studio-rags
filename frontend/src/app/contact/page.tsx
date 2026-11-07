import type { Metadata } from "next";
import { ContactForm } from "@/components/contact-form";
import { pageWrap } from "@/components/ui";
import { formatLongDay, formatTime } from "@/lib/adelaide";
import { getWorkshop } from "@/lib/catalogue";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Ask Rehana about a class, a date, or a private event at Studio Rags.",
};

/**
 * "Ask about this date" links here with ?class=<slug>&date=<ISO>. The message
 * is pre-filled from the real class, so a made-up slug or date in the URL only
 * ever produces a blank form, never text the visitor did not choose.
 */
async function draftMessage(slug?: string, date?: string): Promise<string> {
  if (!slug) return "";
  const workshop = await getWorkshop(slug);
  if (!workshop.ok) return "";
  const when = date && !Number.isNaN(Date.parse(date)) ? date : null;
  return when
    ? `Hello Rehana, I’d like a place in ${workshop.data.title} on ${formatLongDay(when)} at ${formatTime(when)}.`
    : `Hello Rehana, I’d like to know about the next ${workshop.data.title}.`;
}

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string; date?: string }>;
}) {
  const params = await searchParams;
  const initialMessage = await draftMessage(params.class, params.date);

  return (
    <div className={`${pageWrap} grid gap-10 py-12 lg:grid-cols-[0.9fr_1.1fr]`}>
      <div>
        <h1 className="font-display text-[clamp(2.2rem,5vw,3.2rem)] leading-tight font-black text-plum">
          Contact Rehana
        </h1>
        <p className="mt-4 max-w-[46ch] text-[1.1rem] text-body">
          Ask about a class or a date, or plan a private event for a birthday,
          a team or a group of friends. Rehana replies by email.
        </p>
        <p className="mt-4 max-w-[46ch] text-muted">
          Private events are arranged by message rather than booked online, so
          she can shape the day around your group.
        </p>
      </div>
      <div className="rounded-[var(--radius-card)] border-2 border-line bg-card p-6 sm:p-8">
        <ContactForm initialMessage={initialMessage} />
      </div>
    </div>
  );
}
