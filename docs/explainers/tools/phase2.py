"""Phase 2 explainer: the catalogue and the public site.

    python3 docs/explainers/tools/phase2.py
"""

import sys

from explainer import (ROOT, Page, Repo, boxes, esc, example, flow, rail, sequence,
                       shell, snippet, step, table, tag)

REF, BASE = "94abb4a", "83eb46d"
repo = Repo(REF)
pg = Page(repo)
c = pg.code

# ── Flow 1: the class page ──────────────────────────────────────────────────

f1_diagram = sequence(
    [("b", "Visitor", "browser"), ("p", "ClassPage", "vercel"), ("l", "get()", "vercel"),
     ("w", "WorkshopsController", "render"), ("s", "CatalogueService", "render"), ("d", "Postgres", "neon")],
    [
        dict(frm="b", to="p", text="GET /classes/batik-workshop", n=1),
        dict(frm="p", to="l", text="getWorkshopSessions(slug)", n=2),
        dict(frm="l", to="w", text="GET …/batik-workshop/sessions", n=3),
        dict(frm="w", to="w", text="ThrottlerGuard → JwtAuthGuard: @Public, let through", note=True),
        dict(frm="w", to="s", text="listWorkshopSessions(slug, now)", n=4),
        dict(frm="s", to="d", text="findFirst · findMany · groupBy", n=4),
        dict(frm="d", to="s", text="rows", back=True),
        dict(frm="s", to="s", text="toSession: 8 − 0 = 8 left", n=5),
        dict(frm="s", to="w", text="{ workshop, sessions }", back=True),
        dict(frm="w", to="l", text="200 JSON", back=True),
        dict(frm="l", to="l", text="kept for 60 s in Next's data cache", note=True),
        dict(frm="l", to="p", text="{ ok: true, data }", back=True),
        dict(frm="p", to="b", text="HTML with the dates", back=True),
    ],
    "Opening a class page. The numbers match the steps below. getWorkshop runs the same way "
    "in parallel, against GET /api/v1/workshops/batik-workshop; it is left off to keep the picture readable.",
)

f1_steps = [
    step(1, "vercel", "<code>ClassPage</code> asks for the class and its dates at once",
         "<p>A server component: it runs on Vercel, never in the visitor's browser. Both calls start "
         "together with <code>Promise.all</code>, so the page waits for the slower one, not the sum.</p>"
         "<p>Each call returns a result, not an exception: <code>not-found</code> becomes the site's 404 "
         "through <code>notFound()</code>, and <code>unavailable</code> (the API asleep or too slow) "
         "renders <code>ApiUnavailable</code> instead of an error page.</p>",
         c("frontend/src/app/classes/[slug]/page.tsx", 27, 42, "export default async function ClassPage"),
         ex=[("URL", "/classes/batik-workshop"), ("slug", "batik-workshop")]),
    step(2, "vercel", "<code>get()</code> calls Render directly and keeps the answer for 60 seconds",
         "<p><code>getWorkshopSessions</code> only builds the path. <code>get()</code> does the work: it "
         "prefixes <code>apiOrigin()</code>, which on Vercel is <code>https://studio-rags-api.onrender.com</code> "
         "and locally <code>http://localhost:3001</code>. The variable is not <code>NEXT_PUBLIC_</code>, so it never "
         "reaches the browser.</p>"
         "<ul><li><code>revalidate: 60</code> keeps the JSON in Next's data cache. The next visitor within a minute "
         "costs Render nothing.</li><li><code>AbortSignal.timeout(8000)</code> turns a sleeping API into "
         "<code>unavailable</code> after 8 seconds instead of hanging the page.</li><li>404 is passed back as "
         "<code>not-found</code>; anything else not OK is <code>unavailable</code>.</li></ul>",
         c("frontend/src/lib/catalogue.ts", 64, 73, "export async function getWorkshopSessions")
         + c("frontend/src/lib/catalogue.ts", 27, 40, "async function get<T>"),
         ex=[("request", "GET https://studio-rags-api.onrender.com/api/v1/workshops/batik-workshop/sessions")]),
    step(3, "render", "Three global guards run, then the controller",
         "<p>The path is assembled from three places: <code>setGlobalPrefix('api/v1')</code>, "
         "<code>@Controller('workshops')</code> and <code>@Get(':slug/sessions')</code>.</p>"
         "<p>Before the method runs, Nest applies the guards registered in <code>AppModule</code>, in order. "
         "<code>ThrottlerGuard</code> counts the caller against 120 requests a minute. "
         "<code>JwtAuthGuard</code> makes every route private unless it carries <code>@Public()</code>, so a new "
         "admin route cannot be left open by forgetting a decorator. <code>RolesGuard</code> has nothing to check here.</p>"
         "<p>The controller passes <code>new Date()</code> as <code>now</code>, so the service never reads the clock "
         "and tests can pin the time.</p>",
         c("backend/src/app.module.ts", 43, 45, "ThrottlerGuard")
         + c("backend/src/common/guards/jwt-auth.guard.ts", 17, 24, "canActivate")
         + c("backend/src/catalogue/workshops.controller.ts", 30, 39, "FR-C3")),
    step(4, "render", "The service runs three queries through Prisma",
         "<ol><li><b>The workshop</b>, only if <code>PUBLISHED</code>. A draft and a typo get the same 404, so "
         "the API cannot reveal that a draft exists.</li>"
         "<li><b>Its sessions</b> that are on sale: <code>SCHEDULED</code> and in the future. At most 24, "
         "earliest first. <code>sessionSelect</code> leaves out <code>onlineJoinUrl</code>, so the Zoom link "
         "is never in public JSON.</li>"
         "<li><b>The seats taken</b> for those session ids, in one grouped query (step 5).</li></ol>",
         c("backend/src/catalogue/catalogue.service.ts", 140, 160, "async listWorkshopSessions")
         + c("backend/src/catalogue/catalogue.service.ts", 68, 75, "Public sessions"),
         second_host="neon"),
    step(5, "render", "Seats: one sum per session, then capacity minus taken",
         "<p><code>seatsTaken</code> is a single <code>groupBy</code> over every session on the page, not one "
         "query per date. Which bookings hold a seat is decided in one place, "
         "<code>seatHoldingBookings</code>: a confirmed booking, or a pending one whose hold has not run out yet. An expired hold frees its seats at once, before any cleanup job marks it.</p>"
         "<p>Phase 3's checkout must use this same function inside its row lock, or the page and the payment "
         "will disagree about how many seats are left.</p>"
         "<p><code>toSession</code> clamps at zero and sets <code>isFull</code>. A full date stays in the list, "
         "labelled \"Fully booked\" in words.</p>",
         c("backend/src/catalogue/catalogue.service.ts", 228, 240, "Seats held per session")
         + c("backend/src/catalogue/availability.ts", 11, 26, "export function seatHoldingBookings")
         + snippet('''SELECT "sessionId", SUM(seats)
FROM bookings
WHERE "sessionId" IN ($1, $2, …)
  AND (status = 'CONFIRMED'
       OR (status = 'PENDING' AND "holdExpiresAt" > $now))
GROUP BY "sessionId";''', "Shape of the SQL Prisma sends (illustrative, not copied from a log)", "sh")
         + c("backend/src/catalogue/catalogue.service.ts", 309, 325, "function toSession("),
         ex=[("session", "cmw6cmtig00050sa2fxenxjee"), ("startsAt", "2026-11-13T23:30:00.000Z"),
             ("shown as", "Saturday 14 November, 10:00 am (Adelaide)"),
             ("capacity − taken", "8 − 0 → seatsLeft 8"), ("priceCents", "8200 → $82")]),
]

f1 = flow("class-page", 1, "Opening a class page",
          "The page is HTML rendered on Vercel. The data comes from Render, which reads Neon. "
          "This is the deepest path in the phase; the other flows reuse parts of it.",
          rail([("browser", "GET /classes/batik-workshop"), ("vercel", "ClassPage"),
                ("vercel", "getWorkshopSessions → get()"), ("render", "WorkshopsController.sessions"),
                ("render", "CatalogueService.listWorkshopSessions"), ("render", "seatsTaken → toSession"),
                ("neon", "workshops · sessions · bookings")]),
          f1_diagram, f1_steps)

# ── Flow 2: live seats in the browser ───────────────────────────────────────

f2_diagram = sequence(
    [("b", "SessionList", "browser"), ("v", "studio-rags.vercel.app", "vercel"),
     ("w", "WorkshopsController", "render"), ("d", "Postgres", "neon")],
    [
        dict(frm="b", to="v", text="GET /api/v1/…/sessions  no-store", n=1),
        dict(frm="v", to="v", text="rewrite /api/v1/:path* → Render", n=2),
        dict(frm="v", to="w", text="same path, on onrender.com", n=2),
        dict(frm="w", to="d", text="Flow 1, steps 3 to 5", note=True),
        dict(frm="w", to="v", text="200 JSON", back=True),
        dict(frm="v", to="b", text="200 JSON", back=True),
        dict(frm="b", to="b", text="setSessions(fresh)", n=3),
    ],
    "After the HTML arrives, the browser asks again for the seat counts, uncached. "
    "It only ever talks to the Vercel address.",
)

f2 = flow("live-seats", 2, "Seat counts refreshed in the browser",
          "The HTML can be up to a minute old. Seat numbers cannot wait that long, so "
          "<code>SessionList</code> asks again as soon as it mounts.",
          rail([("browser", "SessionList useEffect"), ("browser", "fetch /api/v1/…/sessions"),
                ("vercel", "next.config.ts rewrite"), ("render", "WorkshopsController.sessions"),
                ("neon", "same three queries")]),
          f2_diagram, [
              step(1, "browser", "<code>SessionList</code> refetches on mount",
                   "<p>A client component, so this code runs in the visitor's browser. It starts with the "
                   "sessions the server rendered, then replaces them with a fresh answer.</p>"
                   "<p>The URL is relative, so the request goes to <code>studio-rags.vercel.app</code>, the address "
                   "the page came from. <code>cache: \"no-store\"</code> skips every cache. If the call fails, "
                   "the server-rendered dates simply stay.</p>",
                   c("frontend/src/components/session-list.tsx", 31, 46, "useEffect(() => {")),
              step(2, "vercel", "Vercel forwards <code>/api/v1/*</code> to Render",
                   "<p>No code of ours runs here. Vercel's edge matches the rewrite and fetches the same path from "
                   "Render. The browser sees one site, so there is no CORS preflight, and in Phase 3 the login "
                   "cookies will belong to the site's own address.</p>"
                   "<p>The destination is resolved when Vercel <em>builds</em> the site. Changing "
                   "<code>API_ORIGIN</code> needs a redeploy before the rewrite follows it.</p>",
                   c("frontend/next.config.ts", 23, 36, "async rewrites()")),
              step(3, "browser", "The button is only a link",
                   "<p>Nothing is booked or held in Phase 2. \"Ask about this date\" is a link to the contact "
                   "form with the class and date in the query string, which Flow 3 picks up. A full date has no link.</p>",
                   c("frontend/src/components/session-list.tsx", 95, 103, "{!s.isFull && ("),
                   ex=[("link", "/contact?class=batik-workshop&date=2026-11-13T23:30:00.000Z")]),
          ])

# ── Flow 3: the contact form ────────────────────────────────────────────────

f3_diagram = sequence(
    [("b", "ContactForm", "browser"), ("p", "ContactPage", "vercel"),
     ("a", "Render API", "render"), ("s", "EnquiriesService", "render"), ("d", "Postgres", "neon")],
    [
        dict(frm="b", to="p", text="GET /contact?class=…&date=…", n=1),
        dict(frm="p", to="a", text="GET /api/v1/workshops/batik-workshop", n=1),
        dict(frm="a", to="p", text="{ title, … }", back=True),
        dict(frm="p", to="b", text="form, message already drafted", back=True),
        dict(frm="b", to="b", text="onSubmit → validate()", n=2),
        dict(frm="b", to="a", text="POST /api/v1/contact (through the Vercel rewrite)", n=2),
        dict(frm="a", to="a", text="ThrottlerGuard: 5 per 10 min per caller", note=True),
        dict(frm="a", to="s", text="create(dto)", n=3),
        dict(frm="s", to="d", text="INSERT INTO enquiries", n=4),
        dict(frm="a", to="b", text="202 { message }", back=True),
    ],
    "Asking about a date. The page is drafted on the server; the post comes from the browser.",
)

f3 = flow("contact", 3, "Asking about a date",
          "The only write in Phase 2. One row in <code>enquiries</code>, no email yet (that is Phase 4).",
          rail([("browser", "Ask about this date"), ("vercel", "ContactPage → draftMessage"),
                ("browser", "ContactForm.onSubmit"), ("vercel", "rewrite"),
                ("render", "EnquiriesController.create"), ("render", "EnquiriesService.create"),
                ("neon", "INSERT enquiries")]),
          f3_diagram, [
              step(1, "vercel", "<code>ContactPage</code> drafts the message",
                   "<p>The query string is untrusted, so the page looks the slug up through the same "
                   "<code>getWorkshop</code> as Flow 1 and uses the title the API returns. An unknown slug gives an empty "
                   "message. A date that does not parse falls back to asking about the next one.</p>",
                   c("frontend/src/app/contact/page.tsx", 18, 34, "async function draftMessage"),
                   ex=[("query", "?class=batik-workshop&date=2026-11-13T23:30:00.000Z"), ("message", "Hello Rehana, I'd like a place in <title> on <day> at <time>.")]),
              step(2, "browser", "<code>onSubmit</code> validates, then posts",
                   "<p><code>validate()</code> runs first and puts each error in words next to its field. Only a "
                   "clean form is sent. The post is relative, so it goes through the Vercel rewrite like Flow 2.</p>"
                   "<p>Why the browser posts, not a server action: the throttle is per caller. From a server action every "
                   "post would come from Vercel's address, and one sender could use up everyone's allowance.</p>",
                   c("frontend/src/components/contact-form.tsx", 105, 120, "try {")
                   + c("frontend/src/components/contact-form.tsx", 286, 289, "Honeypot")),
              step(3, "render", "The controller: throttled, validated, 202",
                   "<p><code>@Throttle</code> overrides the global limit for this route: 5 posts per 10 minutes. "
                   "The sixth gets 429 before any code of ours runs.</p>"
                   "<p>The global <code>ValidationPipe</code> rejects unknown fields and bad values against "
                   "<code>CreateEnquiryDto</code> with 400. 202 means accepted, not handled: Rehana replies later.</p>",
                   c("backend/src/enquiries/enquiries.controller.ts", 14, 22, "FR-C13")),
              step(4, "render", "The service: honeypot, then one insert",
                   "<p><code>website</code> is a hidden field a person never fills. When it has a value, the service "
                   "stores nothing but the controller still answers 202, so a bot learns nothing.</p>"
                   "<p>The class name travels inside the message text. <code>enquiries</code> has no foreign key "
                   "to a workshop.</p>",
                   c("backend/src/enquiries/enquiries.service.ts", 19, 43, "async create"),
                   second_host="neon"),
          ])

# ── Flow 4: home and class list ─────────────────────────────────────────────

f4 = flow("home", 4, "The home page and the class list",
          "Both pages make one call, <code>getWorkshops</code>, through the same <code>get()</code> as Flow 1.",
          rail([("browser", "GET / or /classes?type=…"), ("vercel", "Home · ClassesPage"),
                ("vercel", "getWorkshops → get()"), ("render", "WorkshopsController.list"),
                ("render", "listWorkshops"), ("neon", "workshops + next date")]),
          "", [
              step(1, "vercel", "Rendered per visit, not at build time",
                   "<p><code>await connection()</code> tells Next.js not to pre-render the home page during the "
                   "build. CI builds with no API running, so a build-time render would bake in an empty catalogue. "
                   "The data is still cached for 60 seconds by <code>get()</code>.</p>"
                   "<p>The class list filters by <code>?type</code> on Vercel, after the call, so both pages share "
                   "one cached response.</p>",
                   c("frontend/src/app/page.tsx", 37, 40, "export default async function Home")
                   + c("frontend/src/app/classes/page.tsx", 24, 32, "const { type }")),
              step(2, "render", "<code>listWorkshops</code>: published classes and each one's next date",
                   "<p>Two queries, whatever the number of classes: the published workshops in their set order, then "
                   "<code>nextSessions</code> for all of their ids at once, which gives each card its next date.</p>",
                   c("backend/src/catalogue/workshops.controller.ts", 14, 19, "FR-C1")
                   + c("backend/src/catalogue/catalogue.service.ts", 81, 92, "async listWorkshops"),
                   second_host="neon"),
          ])

# ── Flow 5: the calendar ────────────────────────────────────────────────────

f5 = flow("calendar", 5, "The calendar",
          "One month at a time, in Adelaide time, at most six months ahead.",
          rail([("browser", "GET /calendar?month=2026-11"), ("vercel", "CalendarPage → getSessions"),
                ("render", "SessionsController.list"), ("render", "resolveRange"),
                ("render", "listSessions"), ("neon", "sessions in range")]),
          "", [
              step(1, "vercel", "The page turns a month into a time range",
                   "<p><code>monthRange</code> gives the first and last instant of the month in "
                   "<code>Australia/Adelaide</code>, so a 10 am class on the 1st is not pushed into the previous "
                   "month by UTC. Months beyond six ahead are clamped.</p>",
                   c("frontend/src/app/calendar/page.tsx", 38, 44, "const { month: requested }")),
              step(2, "render", "The API refuses ranges it was not built for",
                   "<p><code>resolveRange</code> defaults to 31 days from now and refuses more than 92, with 400. "
                   "The page never asks for that much; the limit protects the API from other callers.</p>",
                   c("backend/src/catalogue/sessions.controller.ts", 11, 24, "FR-C3. The calendar")
                   + c("backend/src/catalogue/dto/session-range.dto.ts", 27, 45, "export function resolveRange(")),
          ])

# ── Reference sections ──────────────────────────────────────────────────────

data_section = (
    '<h2 id="data">What the database sees</h2>'
    '<p class="sub">No migration this phase. The tables came from Phase 1; Phase 2 reads three and writes one.</p>'
    + table(["Table", "Read or write", "Where", "What it uses"], [
        ["<code>workshops</code>", "read", "<code>listWorkshops</code>, <code>getWorkshop</code>, <code>listWorkshopSessions</code>",
         "<code>status = 'PUBLISHED'</code>, slug, title, price, photo path"],
        ["<code>sessions</code>", "read", "every catalogue query",
         "<code>status = 'SCHEDULED'</code>, <code>startsAt &gt; now</code>, capacity. Never <code>onlineJoinUrl</code>"],
        ["<code>bookings</code>", "read (a sum)", "<code>seatsTaken</code>",
         "seats, status, <code>holdExpiresAt</code>. Empty until Phase 3"],
        ["<code>enquiries</code>", "insert", "<code>EnquiriesService.create</code>",
         "kind, name, email, message. <code>handledAt</code> stays null"],
    ])
    + "<p class=\"prose\">Photos are not in the database. It stores a path such as "
    "<code>/images/classes/batik-workshop.jpg</code>, and the file ships with the frontend in "
    "<code>frontend/public/</code>, so Vercel serves it from its CDN.</p>"
)

decisions = (
    '<h2 id="decisions">Why it is built this way</h2>'
    '<p class="sub">Each choice, what it replaced, and what it costs.</p>'
    + table(["Chosen", "Instead of", "Because", "Cost"], [
        ["Render per visit, cache data 60 s", "HTML built once at deploy",
         "CI has no API to build against, and a new date would wait for the next deploy",
         "The first visitor each minute waits on the API"],
        ["Browser refetches seats with <code>no-store</code>", "Trust the 60 s cache",
         "A seat count a minute old can be wrong", "One extra request per class page view"],
        ["Browser posts the contact form", "A server action",
         "The throttle is per caller; through a server action every caller is Vercel", "The browser needs a route to the API: the rewrite"],
        ["Full dates stay listed", "Hide them", "A missing Saturday looks like she never ran one", "Rows you cannot ask about"],
        ["One seat rule, <code>seatHoldingBookings</code>", "Count confirmed only",
         "Confirmed-only shows seats someone is paying for right now", "Phase 3 must use it under its lock"],
        ["Zoom link left out of <code>sessionSelect</code>", "Return it and hide it in React",
         "Anything in the JSON is public", "A separate query for confirmed bookings later"],
    ])
)

failures = (
    '<h2 id="failures">When it goes wrong</h2>'
    '<p class="sub">What the code does, what a visitor sees, and how to tell from outside.</p>'
    + table(["Failure", "Code path", "Visitor sees", "How to spot it"], [
        ["Render asleep, or slower than 8 s", "<code>get()</code> aborts, returns <code>unavailable</code>",
         "\"We couldn't load this class just now\"", "Render wakes in about a minute; reload"],
        ["Draft or misspelt slug", "<code>NotFoundException</code> → 404", "The site's 404 page", "API answers 404 \"Class not found\""],
        ["Sixth contact post in 10 minutes", "<code>@Throttle</code> rejects before the controller",
         "\"Please wait ten minutes and try again\"", "HTTP 429; no sixth row"],
        ["Honeypot filled", "<code>create</code> returns <code>'discarded'</code>, still 202",
         "The normal thank-you", "Log line \"Contact form honeypot filled\""],
        ["Browser seat refetch fails", "<code>SessionList</code> ignores the error", "The server-rendered dates",
         "Network panel shows the <code>/sessions</code> call failing"],
        ["Range over 92 days", "<code>resolveRange</code> throws", "Never, from the site", "400 \"A range can cover at most 92 days\""],
    ])
    + pg.code("frontend/src/components/api-unavailable.tsx", 8, 16, "export function ApiUnavailable",
              note="The message a visitor sees while Render wakes up.")
)

verify = (
    '<h2 id="verify">Check it yourself</h2>'
    '<p class="sub">Read-only, against staging. Wake Render first: the first call can take a minute.</p>'
    + snippet("curl -s https://studio-rags.vercel.app/api/v1/workshops/batik-workshop/sessions",
              "Through Vercel, exactly as the browser does it", "sh")
    + "<p class=\"prose\">Expect 200 and a <code>sessions</code> array whose first entry has "
      "<code>seatsLeft</code> 8 and <code>priceCents</code> 8200.</p>"
    + snippet('curl -s -o /dev/null -w "%{http_code}\\n" https://studio-rags.vercel.app/api/v1/workshops/no-such-class',
              "A slug that does not exist", "sh")
    + "<p class=\"prose\">Expect <code>404</code>.</p>"
    + snippet("cd backend && npx jest src/catalogue src/enquiries\nnpm run test:e2e -- catalogue enquiries",
              "The tests that pin this behaviour (local, against studio_rags_test)", "sh")
    + table(["Test file", "What it locks"], [
        ["<code>backend/src/catalogue/availability.spec.ts</code>", "Which bookings hold a seat; seats left never below zero"],
        ["<code>backend/src/catalogue/dto/session-range.dto.spec.ts</code>", "31-day default, 92-day refusal"],
        ["<code>backend/test/catalogue/workshops.e2e-spec.ts</code>", "Drafts are 404; response shape; no Zoom link"],
        ["<code>backend/test/catalogue/sessions.e2e-spec.ts</code>", "Calendar range and the availability endpoint"],
        ["<code>backend/test/enquiries/contact.e2e-spec.ts</code>", "202, honeypot, unknown fields rejected, sixth post 429"],
        ["<code>frontend/src/lib/adelaide.test.mjs</code>, <code>format.test.mjs</code>", "Adelaide dates and \"Fully booked\" in words"],
    ])
)

ROLES = {
    "CLAUDE.md": "Added the phase-explainer and schema-change rules",
    "backend/prisma/seed.ts": "Six real classes, photo paths and alt text, dated sessions",
    "backend/src/app.controller.spec.ts": "Status check now points at /status",
    "backend/src/app.module.ts": "Registers the catalogue and enquiries modules; global limit 120/min",
    "backend/src/app.service.ts": "Status check now points at /status",
    "backend/src/catalogue/availability.spec.ts": "Seat rule tests",
    "backend/src/catalogue/availability.ts": "<code>seatHoldingBookings</code>, <code>seatsLeft</code>",
    "backend/src/catalogue/catalogue.module.ts": "Wires the two catalogue controllers",
    "backend/src/catalogue/catalogue.service.ts": "Every catalogue query",
    "backend/src/catalogue/catalogue.types.ts": "Response types",
    "backend/src/catalogue/dto/session-range.dto.spec.ts": "Range tests",
    "backend/src/catalogue/dto/session-range.dto.ts": "<code>resolveRange</code>: 31-day default, 92-day cap",
    "backend/src/catalogue/sessions.controller.ts": "<code>GET /sessions</code>, <code>GET /sessions/:id/availability</code>",
    "backend/src/catalogue/workshops.controller.ts": "<code>GET /workshops</code>, <code>/:slug</code>, <code>/:slug/sessions</code>",
    "backend/src/enquiries/dto/create-enquiry.dto.ts": "Contact form validation",
    "backend/src/enquiries/enquiries.controller.ts": "<code>POST /contact</code>, 5 per 10 minutes",
    "backend/src/enquiries/enquiries.module.ts": "Wires the enquiries controller",
    "backend/src/enquiries/enquiries.service.spec.ts": "Honeypot and insert tests",
    "backend/src/enquiries/enquiries.service.ts": "Honeypot, then the insert",
    "backend/test/catalogue/sessions.e2e-spec.ts": "HTTP tests for sessions",
    "backend/test/catalogue/workshops.e2e-spec.ts": "HTTP tests for workshops",
    "backend/test/enquiries/contact.e2e-spec.ts": "HTTP tests for the contact post",
    "backend/test/utils/catalogue.ts": "Test data builders",
    "backend/test/utils/test-app.ts": "Test app setup for the new modules",
    "docs/SPEC.md": "ADR-034 to ADR-038 and phase status",
    "docs/client/2026-11-07_progress-note.md": "Draft progress note for Rehana",
    "docs/deploy/README.md": "Status card moved to /status",
    "docs/explainers/phase-2-catalogue.html": "This page",
    "docs/explainers/phase-2/calendar.jpg": "Screenshot",
    "docs/explainers/phase-2/class.jpg": "Screenshot",
    "docs/explainers/phase-2/contact.jpg": "Screenshot",
    "docs/explainers/phase-2/home.jpg": "Screenshot",
    "frontend/public/brand/logo-full.png": "Logo",
    "frontend/public/brand/logo-mark.png": "Logo mark",
    "frontend/src/app/calendar/page.tsx": "Flow 5",
    "frontend/src/app/classes/[slug]/page.tsx": "Flow 1",
    "frontend/src/app/classes/page.tsx": "Flow 4",
    "frontend/src/app/contact/page.tsx": "Flow 3",
    "frontend/src/app/globals.css": "Fabric Fun tokens for Tailwind",
    "frontend/src/app/layout.tsx": "Fonts, header, footer",
    "frontend/src/app/not-found.tsx": "The 404 page",
    "frontend/src/app/page.tsx": "Flow 4",
    "frontend/src/app/status/page.tsx": "The API status card, moved off the home page",
    "frontend/src/components/api-unavailable.tsx": "The \"couldn't load\" message",
    "frontend/src/components/class-card.tsx": "A class card",
    "frontend/src/components/contact-form.tsx": "Flow 3",
    "frontend/src/components/session-list.tsx": "Flow 2",
    "frontend/src/components/site-footer.tsx": "Footer",
    "frontend/src/components/site-header.tsx": "Header and navigation",
    "frontend/src/components/ui.ts": "Shared class names",
    "frontend/src/lib/adelaide.test.mjs": "Adelaide time tests",
    "frontend/src/lib/adelaide.ts": "Dates in Australia/Adelaide; month ranges",
    "frontend/src/lib/catalogue-types.ts": "View types and the class-type filter",
    "frontend/src/lib/catalogue.ts": "<code>get()</code> and the catalogue calls",
    "frontend/src/lib/format.test.mjs": "Formatting tests",
    "frontend/src/lib/format.ts": "Prices, seats left, \"Fully booked\"",
}
changed = repo.changed(BASE, REF)
missing = [f for f in changed if f not in ROLES and not f.startswith("frontend/public/images/classes/")]
if missing:
    sys.exit("ERROR: changed files with no description: " + ", ".join(missing))
file_rows = [[f"<code>{esc(f)}</code>",
              ROLES.get(f, "Class photo, served by Vercel")] for f in changed]
files = (
    '<h2 id="files">Every file in this phase</h2>'
    f'<p class="sub">{len(changed)} files between <code>{BASE}</code> and <code>{REF}</code> '
    "(the merge of PR #2). This list is generated from git, and the build fails if a file has no description.</p>"
    f'<details class="files"><summary>Show all {len(changed)} files</summary>{table(["File", "Role"], file_rows)}</details>'
)

# ── Page ────────────────────────────────────────────────────────────────────

shots = "".join(
    f'<a href="phase-2/{n}.jpg"><img src="phase-2/{n}.jpg" alt="{esc(a)}" loading="lazy">{esc(t)}</a>'
    for n, t, a in [
        ("home", "Home", "The home page with class cards"),
        ("class", "Class page", "The Batik Workshop page with its dates"),
        ("calendar", "Calendar", "The November calendar"),
        ("contact", "Contact", "The contact form with a drafted message"),
    ])

hero = f"""
<header class="hero">
<p class="eyebrow">Phase 2 · merged 8 November 2026 · PR #2</p>
<h1>The catalogue: how a class page gets its seats</h1>
<p class="lede">Visitors can browse the six classes, see real dates with seats left, and send a question.
Nothing is booked yet. This page follows each click through the code, from the browser to Postgres and back.</p>
</header>
<div class="shots">{shots}</div>
<h2 id="flows">Five flows</h2>
<p class="sub">Every step is tagged with where its code runs: {tag("browser")}{tag("vercel")}{tag("render")}{tag("neon")}.
The <a href="staging.html">staging page</a> explains what those three hosts are.</p>
<ul class="index">
<li><a href="#class-page"><b>1 · Opening a class page</b><span>Server render, guards, three queries, seat maths</span></a></li>
<li><a href="#live-seats"><b>2 · Seats refreshed in the browser</b><span>The uncached refetch and the Vercel rewrite</span></a></li>
<li><a href="#contact"><b>3 · Asking about a date</b><span>The one write: throttle, honeypot, insert</span></a></li>
<li><a href="#home"><b>4 · Home and class list</b><span>Why it renders per visit</span></a></li>
<li><a href="#calendar"><b>5 · The calendar</b><span>Adelaide months and the 92-day cap</span></a></li>
</ul>
"""

body = (hero + f1 + f2 + f3 + f4 + f5 + data_section + decisions + failures + verify + files
        + f'<footer>Code excerpts are read from commit <code>{REF}</code> by '
          "<code>docs/explainers/tools/phase2.py</code>, which fails if any excerpt no longer starts where "
          f"it says. {pg.excerpts} excerpts.</footer>")

out = ROOT / "docs/explainers/phase-2-catalogue.html"
out.write_text(shell("Phase 2 — the catalogue · Studio Rags",
                     [("flows", "Flows"), ("data", "Database"), ("decisions", "Decisions"),
                      ("failures", "Failures"), ("verify", "Check it"), ("files", "Files")],
                     body, ("staging.html", "Staging")))
print(f"wrote {out.relative_to(ROOT)}: {pg.excerpts} excerpts, {len(changed)} files described")
