-- Links each refresh token issued by a refresh to the token that refresh
-- spent, so reuse detection can follow a rotated token forward. A rotated
-- token that comes back late, while its successor was never used, is what a
-- browser holds when the refresh response never reached it: ending that one
-- session is enough. Only a late token whose successor somebody did use means
-- two parties held it, and ends every session.
--
-- Additive and nullable: existing rows keep a null link. UNIQUE because a
-- token can be spent once, so it has at most one successor. ON DELETE SET
-- NULL so deleting an old row never takes its successor with it.

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "rotatedFromId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_rotatedFromId_key" ON "refresh_tokens"("rotatedFromId");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_rotatedFromId_fkey" FOREIGN KEY ("rotatedFromId") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;
