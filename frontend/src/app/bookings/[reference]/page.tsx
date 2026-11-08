import type { Metadata } from "next";
import { BookingDetail } from "@/components/booking-detail";
import { pageWrap } from "@/components/ui";

export const metadata: Metadata = {
  title: "Your booking",
  robots: { index: false },
};

/**
 * One booking, at a permanent address: the hold to confirm, then the
 * confirmation. Drawn in the browser, which holds the session (ADR-042).
 */
export default async function BookingPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  return (
    <div className={`${pageWrap} py-8 sm:py-10`}>
      <div className="booking-flow mx-auto w-full max-w-2xl">
        {/* Keyed, so moving to another booking starts afresh. */}
        <BookingDetail key={reference} reference={reference} />
      </div>
    </div>
  );
}
