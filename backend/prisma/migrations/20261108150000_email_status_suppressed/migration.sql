-- A fourth email status for mail deliberately not sent: on staging only the
-- addresses in MAIL_ALLOWED_RECIPIENTS receive real email (ADR-040), and
-- everyone else gets an email_logs row marked SUPPRESSED instead of a provider
-- call. Kept apart from FAILED so a deliberate skip is never counted, alerted
-- on or retried as a failure. Additive only: no existing row changes.

-- AlterEnum
ALTER TYPE "EmailStatus" ADD VALUE 'SUPPRESSED';
