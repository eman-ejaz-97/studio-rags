/**
 * Which directory Next should treat as the project root, for Turbopack and for
 * output file tracing.
 *
 * The repo root has its own package-lock.json (Neon's CLI). Left alone, Next
 * finds two lockfiles, warns, and treats the repo root as the project root:
 * Turbopack watches the whole repo and the standalone output nests the app
 * under frontend/. Pinning both roots to frontend/ keeps local, CI and Docker
 * builds self-contained.
 *
 * Not on Vercel. Its build adapter locates the app as the path from
 * outputFileTracingRoot to the project, so with the root pinned to frontend/
 * that path is empty: it looks for .next at the repo root, and the deploy
 * fails after a green build (ENOENT on .next/routes-manifest-deterministic.json).
 */
export function pinnedRoots(
  dir: string,
  env: Record<string, string | undefined> = process.env,
): { turbopack?: { root: string }; outputFileTracingRoot?: string } {
  if (env.VERCEL) return {};
  return { turbopack: { root: dir }, outputFileTracingRoot: dir };
}
