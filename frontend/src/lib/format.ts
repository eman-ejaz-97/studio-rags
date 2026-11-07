/** Money arrives as integer cents (AUD). "$82", or "$82.50" when there are cents. */
export function formatPrice(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

/** "3 hours", "90 minutes", "2 hours 30 minutes". */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return `${hours} hour${hours === 1 ? "" : "s"}`;
  // Under two hours, minutes read more naturally than "1 hour 30 minutes".
  if (minutes < 120) return `${minutes} minutes`;
  return `${hours} hours ${rest} minutes`;
}

/** "1 place left", "5 places left", "Fully booked". */
export function formatSeatsLeft(seatsLeft: number): string {
  if (seatsLeft <= 0) return "Fully booked";
  return `${seatsLeft} ${seatsLeft === 1 ? "place" : "places"} left`;
}
