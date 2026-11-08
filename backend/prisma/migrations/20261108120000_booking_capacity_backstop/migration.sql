-- FR-A5 step 6, the backstop (SPEC § 5). The booking service locks the
-- session row and counts seats before it writes, so in normal running this
-- never fires. It is here for the code path that forgets the lock: a future
-- admin tool, a script, a hand-written UPDATE. Whatever writes a booking that
-- takes seats, the database itself refuses to take a session over capacity.
--
-- Additive only: two functions and two triggers. Existing rows are not
-- checked, so a session the admin has already lowered below what is booked
-- (allowed by ADR-012) stays as it is; only a write that adds seats to it is
-- refused.

-- "Seats taken" in SQL. The same rule as seatHoldingBookings() in
-- src/catalogue/availability.ts: every CONFIRMED booking, and every PENDING
-- one whose hold has not run out. Keep the two in step.
--
-- The booking columns are TIMESTAMP(3) without a time zone and hold UTC
-- (Prisma's default). now() carries a time zone, so it is turned into UTC
-- explicitly; compared directly, Postgres would shift it by the server's
-- TimeZone setting. COALESCE makes a PENDING row with no hold time a plain
-- false rather than NULL, which a NOT in a WHEN clause would treat as false
-- too and so skip the check.
CREATE FUNCTION booking_holds_seats(
  status "BookingStatus",
  hold_expires_at TIMESTAMP(3)
) RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT status = 'CONFIRMED'
      OR (status = 'PENDING'
          AND COALESCE(hold_expires_at > (now() AT TIME ZONE 'UTC'), false))
$$;

CREATE FUNCTION bookings_enforce_session_capacity() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  room integer;
  taken integer;
BEGIN
  -- Queue behind anyone already booking this session. NO KEY UPDATE conflicts
  -- with itself and with the booking service's FOR UPDATE, so writers still
  -- count one at a time. It does not conflict with the KEY SHARE lock that
  -- the foreign-key check on bookings."sessionId" has already taken on this
  -- row for every concurrent insert. FOR UPDATE would, and two writers that
  -- skipped the service's lock would then deadlock instead of one being
  -- refused.
  SELECT capacity INTO room
    FROM sessions
   WHERE id = NEW."sessionId"
     FOR NO KEY UPDATE;

  -- A plpgsql function sees a fresh snapshot for each statement, so this
  -- count includes every booking committed by whoever held the lock before.
  SELECT COALESCE(SUM(seats), 0) INTO taken
    FROM bookings
   WHERE "sessionId" = NEW."sessionId"
     AND booking_holds_seats(status, "holdExpiresAt");

  -- The message starts with the constraint's name because Prisma passes the
  -- message through but not the CONSTRAINT field; the API recognises the
  -- refusal by that name (bookings/booking-errors.ts).
  IF taken > room THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      CONSTRAINT = 'bookings_session_capacity',
      MESSAGE = format(
        'bookings_session_capacity: session %s would be overbooked, %s seats taken of %s',
        NEW."sessionId", taken, room
      );
  END IF;

  RETURN NULL;
END
$$;

-- Fires only for a new booking that takes seats.
CREATE CONSTRAINT TRIGGER bookings_session_capacity_insert
  AFTER INSERT ON bookings
  FOR EACH ROW
  WHEN (booking_holds_seats(NEW.status, NEW."holdExpiresAt"))
  EXECUTE FUNCTION bookings_enforce_session_capacity();

-- Fires only for a change that adds seats to a session: a lapsed or expired
-- hold being confirmed or revived, more seats, or a move to another session.
-- Releasing seats (the expiry sweep, a cancellation) and confirming a live
-- hold never fire it, so they never wait on the session lock.
CREATE CONSTRAINT TRIGGER bookings_session_capacity_update
  AFTER UPDATE ON bookings
  FOR EACH ROW
  WHEN (
    booking_holds_seats(NEW.status, NEW."holdExpiresAt")
    AND (
      NOT booking_holds_seats(OLD.status, OLD."holdExpiresAt")
      OR NEW.seats > OLD.seats
      OR NEW."sessionId" IS DISTINCT FROM OLD."sessionId"
    )
  )
  EXECUTE FUNCTION bookings_enforce_session_capacity();
