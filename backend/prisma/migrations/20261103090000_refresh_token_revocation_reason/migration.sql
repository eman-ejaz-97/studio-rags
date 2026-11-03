-- Records why each refresh token was revoked, so reuse detection can tell a
-- rotated token coming back (two parties held it: possible theft) from one
-- that sign-out, a password reset or an earlier theft response ended (a stale
-- tab: just a dead token). Additive and nullable: rows revoked before this
-- migration keep a null reason and are treated as dead, never as theft.

-- CreateEnum
CREATE TYPE "RefreshTokenRevocation" AS ENUM ('ROTATED', 'SIGNED_OUT', 'PASSWORD_RESET', 'REUSE_DETECTED');

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "revokedReason" "RefreshTokenRevocation";
