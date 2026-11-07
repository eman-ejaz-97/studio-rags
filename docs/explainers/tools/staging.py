"""Staging explainer: what Vercel, Render and Neon each do.

    python3 docs/explainers/tools/staging.py
"""

from explainer import (ROOT, Page, Repo, boxes, flow, rail, sequence, shell, snippet,
                       step, table, tag)

REF = "94abb4a"
pg = Page(Repo(REF))
c = pg.code

cards = f"""
<div class="cards">
<div class="card">{tag("vercel")}<h3>Runs the website</h3><ul>
<li>Builds <code>frontend/</code> on every push to <code>main</code></li>
<li>Renders pages on its servers in Singapore (<code>sin1</code>)</li>
<li>Serves the photos in <code>frontend/public/</code> from its CDN</li>
<li>Forwards <code>/api/v1/*</code> to Render</li>
<li>Holds <code>API_ORIGIN</code> and <code>SITE_ENV</code></li>
<li>Hobby plan. Does not sleep</li></ul></div>
<div class="card">{tag("render")}<h3>Runs the API</h3><ul>
<li>Builds <code>backend/Dockerfile</code> once CI passes</li>
<li>Runs one container: migrations, then NestJS</li>
<li>Holds every secret: database URLs, JWT keys, storage keys</li>
<li>Checks <code>/api/v1/health/live</code> every few seconds</li>
<li>Free plan, Singapore. <b>Sleeps after 15 minutes idle</b>; the next request waits about a minute</li></ul></div>
<div class="card">{tag("neon")}<h3>Keeps the data</h3><ul>
<li>Postgres 18: workshops, sessions, bookings, enquiries, users</li>
<li>A private storage bucket, <code>assets</code>, for files later</li>
<li>Two addresses: pooled for the app, direct for migrations</li>
<li>Free plan, <code>aws-ap-southeast-1</code> (Singapore)</li>
<li>Sleeps when idle and wakes on the first query</li></ul></div>
</div>
"""

architecture = boxes(1300, 220, {
    "b": (20, 55, 180, 110, "browser", "Visitor's phone", ["studio-rags", ".vercel.app"]),
    "v": (300, 20, 260, 170, "vercel", "Next.js frontend", ["renders pages", "serves /public photos", "rewrites /api/v1/*", "API_ORIGIN, SITE_ENV"]),
    "r": (660, 20, 260, 170, "render", "NestJS API, Docker", ["/api/v1 controllers", "guards and throttle", "migrates on start", "secrets live here"]),
    "n": (1020, 20, 260, 170, "neon", "Postgres 18", ["tables", "bucket: assets", "pooled + direct", "sleeps when idle"]),
}, [
    ([(200, 110), (300, 110)], "HTTPS", False),
    ([(560, 110), (660, 110)], "fetch,\nrewrite", False),
    ([(920, 110), (1020, 110)], "Prisma", False),
], "At run time. The browser only ever talks to Vercel; Render and Neon are never addressed by the visitor.")

deploy = boxes(1280, 420, {
    "l": (20, 120, 200, 100, "laptop", "git push", ["a PR merged to main"]),
    "g": (300, 120, 250, 100, "github", "Repo + Actions CI", ["lint · types · tests", "e2e · docker build"]),
    "v": (650, 20, 280, 110, "vercel", "Builds frontend/", ["on every push", "next build, then live"]),
    "r": (650, 180, 280, 140, "render", "Builds backend/", ["only once CI passes", "only if backend/**", "start: migrate deploy", "then: node dist/main"]),
    "n": (1030, 200, 230, 100, "neon", "Postgres 18", ["new migrations", "applied here"]),
}, [
    ([(220, 170), (300, 170)], "push", False),
    ([(550, 150), (600, 150), (600, 75), (650, 75)], "every push", False, (600, 110)),
    ([(550, 190), (600, 190), (600, 250), (650, 250)], "checks pass", False, (600, 222)),
    ([(930, 250), (1030, 250)], "migrate", False),
    ([(120, 220), (120, 385), (1145, 385), (1145, 300)], "seed: by hand, from your laptop, over the direct address", True, (630, 385)),
], "How code reaches each host. Nothing is uploaded by hand: both hosts pull from GitHub. Only the seed is run manually.")

# ── One request ─────────────────────────────────────────────────────────────

req_seq = sequence(
    [("b", "Visitor", "browser"), ("v", "Next.js", "vercel"), ("r", "NestJS", "render"), ("n", "Postgres", "neon")],
    [
        dict(frm="b", to="v", text="GET /classes/batik-workshop", n=1),
        dict(frm="v", to="r", text="fetch API_ORIGIN + /api/v1/…", n=1),
        dict(frm="r", to="r", text="asleep? this request waits about a minute", note=True),
        dict(frm="r", to="n", text="SQL over DATABASE_URL", n=3),
        dict(frm="n", to="r", text="rows", back=True),
        dict(frm="r", to="v", text="JSON", back=True),
        dict(frm="v", to="b", text="HTML", back=True),
        dict(frm="b", to="v", text="GET /api/v1/…/sessions", n=2),
        dict(frm="v", to="r", text="rewrite: same path", n=2),
        dict(frm="r", to="v", text="JSON", back=True),
        dict(frm="v", to="b", text="JSON", back=True),
    ],
    "The two ways a request reaches Render: from Vercel's server while it renders a page (1), "
    "and from the browser through the rewrite (2). Both end in the same controllers.",
)

request = flow("request", 1, "One page view, across the three hosts",
               "Phase 2's class page, seen from the hosting side. The code-level detail is on the "
               "<a href=\"phase-2-catalogue.html#class-page\">Phase 2 page</a>.",
               rail([("browser", "studio-rags.vercel.app"), ("vercel", "ClassPage renders"),
                     ("render", "studio-rags-api.onrender.com/api/v1"), ("neon", "pooled connection")]),
               req_seq, [
                   step(1, "vercel", "Vercel's server calls Render by name",
                        "<p>While rendering, Next.js runs on Vercel and needs the API's real address. "
                        "<code>apiOrigin()</code> reads <code>API_ORIGIN</code>, set in Vercel's project settings to "
                        "<code>https://studio-rags-api.onrender.com</code>. A deployed build without it fails loudly "
                        "rather than pointing at a localhost that does not exist on Vercel.</p>",
                        c("frontend/src/lib/api-origin.ts", 13, 28, "export function apiOrigin")),
                   step(2, "vercel", "The browser calls Vercel, and Vercel forwards",
                        "<p>Code running in the browser uses relative URLs like <code>/api/v1/contact</code>. "
                        "Vercel matches the rewrite and fetches the same path from Render, then streams the answer back.</p>"
                        "<p>Why not call Render directly: login cookies (Phase 3) use <code>SameSite=Lax</code>, and "
                        "<code>vercel.app</code> and <code>onrender.com</code> are different sites. A cookie set by Render "
                        "would never be sent from the Vercel page. Through the rewrite, every cookie belongs to one address.</p>"
                        "<p>The destination is fixed when Vercel builds. Change <code>API_ORIGIN</code>, then redeploy.</p>",
                        c("frontend/next.config.ts", 23, 36, "async rewrites()")),
                   step(3, "render", "Render runs the API; Neon answers its queries",
                        "<p>Every route lives under <code>/api/v1</code>. <code>trust proxy</code> tells Express how many "
                        "proxies sit in front, so <code>req.ip</code> is the visitor and not a proxy. The throttle depends on "
                        "it, and it is wrong today: see <a href=\"#throttle\">the open issue</a>.</p>"
                        "<p>The running API uses Neon's <b>pooled</b> address, which shares a few real connections among many "
                        "requests. Migrations and the seed use the <b>direct</b> one, because the pooler cannot hold the lock "
                        "that stops two migrations running at once.</p>",
                        c("backend/src/app.setup.ts", 27, 30, "const trustedHops")
                        + c("backend/src/app.setup.ts", 42, 42, "setGlobalPrefix")
                        + c("render.yaml", 60, 67, "# sync: false"),
                        second_host="neon"),
               ])

# ── Deploys ─────────────────────────────────────────────────────────────────

deploys = flow("deploy", 2, "How code gets onto each host",
               "Merge to <code>main</code> and both hosts rebuild themselves from GitHub. There is no upload step.",
               rail([("laptop", "merge PR"), ("github", "CI on main"), ("vercel", "build frontend/"),
                     ("render", "build backend/ when green"), ("render", "migrate, then start"), ("neon", "schema up to date")]),
               deploy, [
                   step(1, "render", "Render reads <code>render.yaml</code> from the repo",
                        "<p>The service is described in code, not clicked together. Two settings decide when it rebuilds: "
                        "<code>autoDeployTrigger: checksPass</code> waits for GitHub Actions to go green, and "
                        "<code>buildFilter</code> skips commits that do not touch <code>backend/</code>. A docs-only merge "
                        "leaves the API alone.</p>"
                        "<p>Vercel has no such gate: it builds every push to <code>main</code>. A red frontend build simply "
                        "does not replace the live one.</p>",
                        c("render.yaml", 16, 33, "- type: web")),
                   step(2, "render", "Each container start migrates, then serves",
                        "<p>The free plan has no pre-deploy hook, so the container does it. <code>prisma migrate deploy</code> "
                        "applies only migrations Neon has not recorded, and is a no-op otherwise. If one fails, "
                        "<code>set -e</code> stops the container and Render keeps the previous version live.</p>"
                        "<p>This is why migrations reach Neon without anyone running them: a merge that adds one applies it on the next start.</p>",
                        c("backend/docker-entrypoint.sh", 13, 21, "set -eu"),
                        second_host="neon"),
                   step(3, "laptop", "The seed is the one manual step",
                        "<p>The seed writes the admin account, six classes and their dates. It runs from your laptop "
                        "straight to Neon over the direct address, reading the credentials from <code>.env.local</code> "
                        "in a subshell so they do not stay in your terminal. You type the admin password; it is never "
                        "stored in a file. Running it twice changes nothing: CI proves that on every push.</p>",
                        c("docs/deploy/README.md", 179, 188, "cd backend"),
                        second_host="neon"),
               ])

# ── Reference ───────────────────────────────────────────────────────────────

config = (
    '<h2 id="config">Where each setting lives</h2>'
    '<p class="sub">Names only. Values are in each host\'s dashboard, never in git.</p>'
    + table(["Setting", "Lives on", "Read by", "Notes"], [
        ["<code>API_ORIGIN</code>", tag("vercel"), "<code>apiOrigin()</code>, the rewrite", "Read at build time; redeploy after changing it"],
        ["<code>SITE_ENV</code>", tag("vercel"), "The \"Test site\" banner, <code>robots.ts</code>", "<code>staging</code>: banner on, search engines kept out"],
        ["<code>DATABASE_URL</code>", tag("render"), "Prisma, at run time", "Neon pooled address, <code>connect_timeout=15</code> so a sleeping Neon can wake"],
        ["<code>DATABASE_URL_UNPOOLED</code>", tag("render") + tag("laptop"), "<code>prisma migrate deploy</code>, the seed", "Neon direct address. On your laptop it is in <code>.env.local</code>"],
        ["<code>AWS_*</code>, <code>STORAGE_BUCKET</code>", tag("render"), "StorageService", "Neon's storage speaks the S3 API, so the AWS SDK talks to it"],
        ["<code>CORS_ORIGIN</code>, <code>APP_URL</code>", tag("render"), "CORS, the password-reset link", "<code>https://studio-rags.vercel.app</code>"],
        ["<code>JWT_ACCESS_SECRET</code>, <code>JWT_REFRESH_SECRET</code>", tag("render"), "Sign-in tokens", "Generated by Render; nobody has seen them"],
        ["<code>TRUST_PROXY</code>", tag("render"), "<code>app.set('trust proxy')</code>", "<code>2</code> in <code>render.yaml</code>. Probably needs <code>3</code>"],
    ])
)

status = (
    '<h2 id="status">Status on 8 November 2026</h2>'
    '<p class="sub">Checked by hand against the live hosts.</p>'
    + table(["Check", "Result"], [
        ["Site", '<span class="status-ok">Live</span> at <a href="https://studio-rags.vercel.app">studio-rags.vercel.app</a>'],
        ["API", '<span class="status-ok">Live</span> at <code>studio-rags-api.onrender.com</code>; <code>/api/v1/health</code> reports database and storage up'],
        ["Rewrite", '<span class="status-ok">Working</span>: <code>/api/v1/workshops</code> on the Vercel address returns the six classes'],
        ["Data", '<span class="status-ok">Seeded</span>: six classes with dates, one admin'],
        ["Per-visitor throttle", '<span class="status-bad">Not holding</span> through Vercel. See below'],
    ])
)

throttle = (
    '<h2 id="throttle">Open issue: the throttle cannot tell visitors apart</h2>'
    '<p class="sub">Must be fixed before the sign-in screens reach staging (SPEC § 10, item 14).</p>'
    '<div class="prose"><p>The login throttle allows 10 attempts a minute per visitor. It identifies a visitor by '
    "<code>req.ip</code>. Behind proxies, Express works that out from <code>X-Forwarded-For</code>, the list of addresses "
    "each proxy appends: it skips <code>TRUST_PROXY</code> entries from the right and takes the next one.</p>"
    "<p><code>render.yaml</code> assumes two proxies: Vercel, then Render's own. The test says otherwise:</p></div>"
    + table(["Test", "Expected", "Got"], [
        ["14 failed logins in a minute, through Vercel", "429 after 10", '<span class="status-bad">401 every time</span>'],
        ["Failed logins straight to Render", "429 after 10", '<span class="status-ok">429</span>'],
        ["Straight to Render with a made-up <code>X-Forwarded-For</code>", "Counted as you", "401: a forged header resets the count (a known gap)"],
    ])
    + '<div class="prose"><p>Render answers with Cloudflare headers (<code>cf-ray</code>), so there is likely one more proxy '
    "than assumed. With 2, <code>req.ip</code> lands on Vercel's outgoing address, which changes from request to request: "
    "every attempt looks like a new visitor. Failed logins write nothing to the database, so the test was safe on staging.</p>"
    "<p><b>Next:</b> set <code>TRUST_PROXY=3</code> in Render's dashboard, repeat the test, then repeat it from a phone on "
    "mobile data to prove two visitors get separate limits. Then write the value into <code>render.yaml</code>.</p></div>"
)

failures = (
    '<h2 id="failures">When staging misbehaves</h2>'
    + table(["Symptom", "Likely cause", "What to do"], [
        ["Pages say the classes can't be shown", "Render is asleep", "Open <code>/api/v1/health/live</code> on the Render address, wait a minute, reload"],
        ["API wakes but errors on the database", "Neon took longer than 15 s to wake", "Reload once; check Neon's dashboard"],
        ["Everything paused near month end", "A free allowance ran out (Render 750 h, Neon 100 CU-h)", "Wait for the reset. Never add a card"],
        ["New backend code not live", "CI failed, or the commit did not touch <code>backend/</code>", "Check Actions; Render's Events tab says why it skipped"],
        ["Vercel build fails on a Google font", "Seen once; a retry built", "Redeploy; runbook has the details"],
        ["Frontend still calls an old API address", "<code>API_ORIGIN</code> changed without a rebuild", "Redeploy on Vercel"],
    ])
)

verify = (
    '<h2 id="verify">Check it yourself</h2>'
    + snippet("curl -s https://studio-rags-api.onrender.com/api/v1/health/live\ncurl -s https://studio-rags.vercel.app/api/v1/health",
              "Wake Render, then check the whole chain through Vercel", "sh")
    + '<p class="prose">The first is Render alone and touches nothing else. The second goes browser → Vercel → Render → '
      "Neon and reports the database and storage. Avoid calling it on a timer: each call wakes Neon and spends free hours.</p>"
)

hero = f"""
<header class="hero">
<p class="eyebrow">Staging · live since 8 November 2026 · costs nothing</p>
<h1>Three hosts, one website</h1>
<p class="lede">The site is split across three free services. Vercel runs the pages, Render runs the API,
Neon keeps the data. This page shows what each one holds, how a request crosses them, and how code gets there.</p>
</header>
{cards}
<h2 id="map">The map</h2>
<p class="sub">Each box is a different company's computer. {tag("browser")}{tag("vercel")}{tag("render")}{tag("neon")}</p>
{architecture}
"""

body = (hero + request + deploys + config + status + throttle + failures + verify
        + f'<footer>Excerpts are read from commit <code>{REF}</code> by <code>docs/explainers/tools/staging.py</code>. '
          f"{pg.excerpts} excerpts. The runbook is <code>docs/deploy/README.md</code>.</footer>")

out = ROOT / "docs/explainers/staging.html"
out.write_text(shell("Staging — Vercel, Render, Neon · Studio Rags",
                     [("map", "Map"), ("request", "A request"), ("deploy", "Deploys"), ("config", "Settings"),
                      ("status", "Status"), ("throttle", "Open issue"), ("failures", "Failures")],
                     body, ("phase-2-catalogue.html", "Phase 2")))
print(f"wrote {out.relative_to(ROOT)}: {pg.excerpts} excerpts")
