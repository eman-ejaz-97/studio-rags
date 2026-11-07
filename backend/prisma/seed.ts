/**
 * Seeds the six classes agreed for the initial build (ADR-020), the client's
 * refund policy (ADR-014) and a South Australian public-holiday calendar.
 *
 * Idempotent — safe to run repeatedly. `npm run db:seed`.
 *
 * Admin password: SEED_ADMIN_PASSWORD (at least 12 characters). Without it the
 * seed falls back to a public development password, and only for a database on
 * localhost. An existing admin keeps its password unless SEED_ADMIN_ROTATE=1.
 */
import {
  DeliveryMode,
  PrismaClient,
  ProductType,
  RefreshTokenRevocation,
  Role,
  SessionStatus,
  WorkshopStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { planExistingAccount, planSeedAdmin } from './seed-guard';
import type { SeedAdminPlan } from './seed-guard';

// Decided before the client exists, so a refused run never reaches the database.
const adminPlan = planSeedAdmin(process.env);
if (!adminPlan.ok) {
  console.error(`✖ Seed refused: ${adminPlan.reason}`);
  process.exit(1);
}

const prisma = new PrismaClient();

/**
 * Prices are the client's real Eventbrite prices as of 2026-09-12. They are
 * STARTING DATA, not constants — she edits them in the admin (ADR-012).
 *
 * Capacity, duration and description are placeholders. She has not given us
 * capacities, and her real class copy lives on Eventbrite. Marked clearly so
 * nobody mistakes this text for her words.
 */
/**
 * The client's own listing copy, taken from her live Eventbrite pages on
 * 2026-09-12. Her words, not ours. Refresh with
 * `tools/fetch_eventbrite_content.py`.
 */
const SUMMARIES: Record<string, string> = {
  'batik-workshop':
    "Welcome to Studio Rags! Let's Batik to try the amazing cultural heritage of Indonesian fabric printing art. Enjoy a relaxing creative day.",
  'shibori-workshop':
    "It's the perfect time to make some cool Indigo Shibori  pieces and create a new look both in your wardrobe and interiors !",
  'pakistani-woodblock-printing':
    'Explore the ancient art of Block printing from the Indus Valley Civilization and create stunning fabrics for your projects or wardrobe.',
  'batik-online':
    'Learn the amazing Indonesian Batik printing at home and reboot your Positive energy with an immersive unique art!',
  'shibori-online':
    'Relax & re-energise your spirits through this Shibori dyeing kit and online class!',
  'kids-and-parents-paint-together':
    'Learn painting in this family friendly class. Cherish your bonding and paint a sweet memory together !',
};

/**
 * Photos are the client's own, from her Eventbrite listings, served by the
 * frontend from public/images/classes. She has confirmed every image she
 * shares is cleared for the website (§ 10, closed 2026-09-12). Alt text
 * describes what is actually in each photo.
 *
 * `schedule` only shapes demo dates: a weekday (0 = Sunday), a start time in
 * Adelaide, and how often. Her real calendar replaces it from the admin.
 */
const WORKSHOPS = [
  {
    slug: 'batik-workshop',
    title: 'Indonesian Batik Workshop',
    priceCents: 8200,
    productType: ProductType.ONE_OFF,
    deliveryMode: DeliveryMode.IN_PERSON,
    durationMinutes: 180,
    defaultCapacity: 8,
    sortOrder: 1,
    image: {
      width: 940,
      height: 470,
      alt: 'Seven workshop guests in gloves hold up long batik scarves in green, blue, red, orange and purple, patterned with pale leaves and flowers.',
    },
    schedule: { weekday: 6, time: '10:00', everyWeeks: 2, firstWeek: 1 },
  },
  {
    slug: 'shibori-workshop',
    title: 'Japanese Shibori Workshop',
    priceCents: 8200,
    productType: ProductType.ONE_OFF,
    deliveryMode: DeliveryMode.IN_PERSON,
    durationMinutes: 180,
    defaultCapacity: 8,
    sortOrder: 2,
    image: {
      width: 940,
      height: 423,
      alt: 'Two smiling guests hold up square cloths they dyed in indigo, one striped, one folded into a geometric diamond pattern.',
    },
    schedule: { weekday: 0, time: '10:00', everyWeeks: 2, firstWeek: 1 },
  },
  {
    slug: 'pakistani-woodblock-printing',
    title: 'Pakistani Woodblock Printing',
    priceCents: 6500,
    productType: ProductType.ONE_OFF,
    deliveryMode: DeliveryMode.IN_PERSON,
    durationMinutes: 180,
    defaultCapacity: 8,
    sortOrder: 3,
    image: {
      width: 940,
      height: 705,
      alt: 'Two carved wooden printing blocks, one a large flower and one a row of knots, lie on cream fabric printed with teal flowers and a maroon border pattern.',
    },
    schedule: { weekday: 6, time: '14:00', everyWeeks: 2, firstWeek: 2 },
  },
  {
    slug: 'batik-online',
    title: 'Indonesian Batik — Online Class',
    priceCents: 10200,
    productType: ProductType.ONLINE,
    deliveryMode: DeliveryMode.ONLINE,
    durationMinutes: 120,
    defaultCapacity: 12,
    sortOrder: 4,
    image: {
      width: 940,
      height: 470,
      alt: 'Rehana, in a red apron, sits in front of a class of women holding up brightly coloured batik scarves, with bottles of dye on the table.',
    },
    schedule: { weekday: 3, time: '18:30', everyWeeks: 3, firstWeek: 1 },
  },
  {
    slug: 'shibori-online',
    title: 'Japanese Shibori — Online Class',
    priceCents: 10200,
    productType: ProductType.ONLINE,
    deliveryMode: DeliveryMode.ONLINE,
    durationMinutes: 120,
    defaultCapacity: 12,
    sortOrder: 5,
    image: {
      width: 940,
      height: 705,
      alt: 'Two people stretch out a long indigo shibori cloth with wavy lime-green lines between them.',
    },
    schedule: { weekday: 4, time: '18:30', everyWeeks: 3, firstWeek: 2 },
  },
  {
    slug: 'kids-and-parents-paint-together',
    title: 'Kids and Parents Paint Together',
    priceCents: 4200,
    productType: ProductType.KIDS,
    deliveryMode: DeliveryMode.IN_PERSON,
    durationMinutes: 90,
    // Counts CHILDREN, not people — every child brings an adult (ADR-016).
    // The price covers the child and their adult together (ADR-033).
    defaultCapacity: 6,
    minAge: 7,
    maxAge: 15,
    requiresAccompanyingAdult: true,
    sortOrder: 6,
    image: {
      width: 940,
      height: 470,
      alt: 'Four children and two adults show off their bright acrylic paintings of birds, flowers, sea creatures and a sunrise.',
    },
    schedule: { weekday: 0, time: '14:00', everyWeeks: 2, firstWeek: 2 },
  },
] as const;

/** Dates per class in the demo calendar. */
const SESSIONS_PER_WORKSHOP = 5;

/**
 * South Australian public holidays, needed because the client's refund policy
 * is written in BUSINESS days (§ 5).
 *
 * ⚠ VERIFY before launch against safework.sa.gov.au. Dates computed here, not
 * taken from an authoritative source, and the substitute-day rules for holidays
 * falling at a weekend vary.
 */
const PUBLIC_HOLIDAYS: Array<[string, string]> = [
  ['2026-10-05', 'Labour Day'],
  ['2026-12-25', 'Christmas Day'],
  ['2026-12-28', 'Proclamation Day (observed)'],
  ['2027-01-01', "New Year's Day"],
  ['2027-01-26', 'Australia Day'],
  ['2027-03-08', 'Adelaide Cup Day'],
  ['2027-03-26', 'Good Friday'],
  ['2027-03-27', 'Easter Saturday'],
  ['2027-03-29', 'Easter Monday'],
  ['2027-04-26', 'Anzac Day (observed)'],
  ['2027-06-14', "King's Birthday"],
  ['2027-10-04', 'Labour Day'],
  ['2027-12-27', 'Christmas Day (observed)'],
  ['2027-12-28', 'Proclamation Day (observed)'],
];

const ADELAIDE = 'Australia/Adelaide';

/** Adelaide's UTC offset in minutes at `at`: 570 in winter, 630 in summer. */
function adelaideOffsetMinutes(at: Date): number {
  const name = new Intl.DateTimeFormat('en-AU', {
    timeZone: ADELAIDE,
    timeZoneName: 'longOffset',
  })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value; // e.g. "GMT+10:30"
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name ?? '');
  if (!m) throw new Error(`Unexpected time zone name: ${name}`);
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -minutes : minutes;
}

/** The UTC instant of a wall-clock time in Adelaide. */
function adelaideTime(
  y: number,
  month: number,
  day: number,
  hhmm: string,
): Date {
  const [hh, mm] = hhmm.split(':').map(Number);
  const asIfUtc = Date.UTC(y, month - 1, day, hh, mm);
  return new Date(asIfUtc - adelaideOffsetMinutes(new Date(asIfUtc)) * 60_000);
}

/** Today's date in Adelaide, as y/m/d and weekday. */
function adelaideToday() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: ADELAIDE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  const y = Number(parts.year);
  const m = Number(parts.month);
  const d = Number(parts.day);
  return { y, m, d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/**
 * Upcoming demo dates: the given weekday, starting `firstWeek` weeks out and
 * repeating every `everyWeeks`, at `time` in Adelaide.
 */
function scheduledDates(
  schedule: {
    weekday: number;
    time: string;
    everyWeeks: number;
    firstWeek: number;
  },
  count: number,
): Date[] {
  const today = adelaideToday();
  const toWeekday = (schedule.weekday - today.weekday + 7) % 7;
  const dates: Date[] = [];
  for (let i = 0; i < count; i += 1) {
    const offset =
      toWeekday + 7 * (schedule.firstWeek + i * schedule.everyWeeks);
    // Date.UTC normalises an overflowing day into the right month and year.
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d + offset));
    dates.push(
      adelaideTime(
        day.getUTCFullYear(),
        day.getUTCMonth() + 1,
        day.getUTCDate(),
        schedule.time,
      ),
    );
  }
  return dates;
}

async function main(admin: Extract<SeedAdminPlan, { ok: true }>) {
  // ── Refund policy ─────────────────────────────────────────────────────────
  const existingPolicy = await prisma.refundPolicy.findFirst({
    where: { isDefault: true },
  });
  const policy =
    existingPolicy ??
    (await prisma.refundPolicy.create({
      data: {
        name: 'Studio Rags standard policy',
        cutoffBusinessDays: 14,
        lateFeeCentsPerPerson: 1500,
        voucherValidityMonths: 6,
        giftCardValidityMonths: 36,
        allowVoucherInsteadOfRefund: true,
        isDefault: true,
      },
    }));
  console.log(`✔ refund policy: ${policy.name}`);

  // ── Admin account ─────────────────────────────────────────────────────────
  const adminEmail = (
    process.env.SEED_ADMIN_EMAIL ?? 'admin@studiorags.com.au'
  ).toLowerCase();
  const hashAdminPassword = () =>
    argon2.hash(admin.password, { type: argon2.argon2id });
  const existing = await prisma.user.findUnique({
    where: { email: adminEmail },
    select: { id: true, role: true },
  });

  if (!existing) {
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: await hashAdminPassword(),
        firstName: 'Rehana',
        lastName: 'Usman',
        role: Role.ADMIN,
        emailVerifiedAt: new Date(),
      },
    });
    console.log(`✔ admin: ${adminEmail} (created)`);
  } else {
    const plan = planExistingAccount(
      existing.role === Role.ADMIN,
      admin.rotatePassword,
    );
    if (plan.action === 'refuse') {
      throw new Error(`Seed refused: ${plan.reason}`);
    }

    if (plan.action === 'rotate') {
      // A password is usually rotated because it leaked, so the sessions
      // opened with it end too, as they do after a password reset.
      const passwordHash = await hashAdminPassword();
      await prisma.$transaction([
        prisma.user.update({
          where: { id: existing.id },
          data: { role: Role.ADMIN, passwordHash },
        }),
        prisma.refreshToken.updateMany({
          where: { userId: existing.id, revokedAt: null },
          data: {
            revokedAt: new Date(),
            revokedReason: RefreshTokenRevocation.PASSWORD_RESET,
          },
        }),
      ]);
      console.log(
        `✔ admin: ${adminEmail} (password replaced, every session signed out)`,
      );
    } else {
      console.log(
        `✔ admin: ${adminEmail} (already exists and keeps its current password; set SEED_ADMIN_ROTATE=1 to replace it)`,
      );
    }
  }

  const wroteDefault =
    admin.usingDefaultPassword && (!existing || admin.rotatePassword);
  if (wroteDefault) {
    console.log(
      '  ⚠ used the public development password; this is allowed on localhost only',
    );
  }

  // ── Catalogue ─────────────────────────────────────────────────────────────
  for (const w of WORKSHOPS) {
    const workshop = await prisma.workshop.upsert({
      where: { slug: w.slug },
      update: {
        title: w.title,
        // Kept in the update path too, otherwise re-seeding leaves stale copy
        // on rows that already exist.
        summary: SUMMARIES[w.slug] ?? w.title,
        description: SUMMARIES[w.slug] ?? w.title,
        basePriceCents: w.priceCents,
        productType: w.productType,
        deliveryMode: w.deliveryMode,
        durationMinutes: w.durationMinutes,
        defaultCapacity: w.defaultCapacity,
        sortOrder: w.sortOrder,
      },
      create: {
        slug: w.slug,
        title: w.title,
        summary: SUMMARIES[w.slug] ?? w.title,
        description: SUMMARIES[w.slug] ?? w.title,
        productType: w.productType,
        deliveryMode: w.deliveryMode,
        status: WorkshopStatus.PUBLISHED,
        durationMinutes: w.durationMinutes,
        basePriceCents: w.priceCents,
        defaultCapacity: w.defaultCapacity,
        minAge: 'minAge' in w ? w.minAge : null,
        maxAge: 'maxAge' in w ? w.maxAge : null,
        requiresAccompanyingAdult:
          'requiresAccompanyingAdult' in w
            ? w.requiresAccompanyingAdult
            : false,
        sortOrder: w.sortOrder,
        refundPolicyId: policy.id,
      },
    });

    // One photo per class, replaced on every run so the alt text stays current.
    const url = `/images/classes/${w.slug}.jpg`;
    await prisma.$transaction([
      prisma.workshopImage.deleteMany({
        where: { workshopId: workshop.id, url },
      }),
      prisma.workshopImage.create({
        data: {
          workshopId: workshop.id,
          url,
          alt: w.image.alt,
          width: w.image.width,
          height: w.image.height,
          position: 0,
          isHero: true,
        },
      }),
    ]);

    // Only tops up a class with nothing on sale, so a re-run never doubles the
    // calendar and never touches dates that real bookings may point at.
    const upcomingSessions = await prisma.session.count({
      where: {
        workshopId: workshop.id,
        status: SessionStatus.SCHEDULED,
        startsAt: { gt: new Date() },
      },
    });
    if (upcomingSessions === 0) {
      for (const startsAt of scheduledDates(
        w.schedule,
        SESSIONS_PER_WORKSHOP,
      )) {
        const endsAt = new Date(
          startsAt.getTime() + w.durationMinutes * 60_000,
        );
        await prisma.session.create({
          data: {
            workshopId: workshop.id,
            startsAt,
            endsAt,
            capacity: w.defaultCapacity,
            location:
              w.deliveryMode === DeliveryMode.IN_PERSON
                ? 'Studio Rags, Sefton Park SA'
                : null,
            onlineJoinUrl:
              w.deliveryMode === DeliveryMode.ONLINE
                ? 'https://zoom.us/j/0000000000?pwd=PLACEHOLDER'
                : null,
          },
        });
      }
    }

    console.log(
      `✔ ${w.title} — $${(w.priceCents / 100).toFixed(2)}, ${w.defaultCapacity} places`,
    );
  }

  // ── Public holidays ───────────────────────────────────────────────────────
  for (const [date, name] of PUBLIC_HOLIDAYS) {
    await prisma.publicHoliday.upsert({
      where: { date: new Date(`${date}T00:00:00.000Z`) },
      update: { name },
      create: { date: new Date(`${date}T00:00:00.000Z`), name, region: 'SA' },
    });
  }
  console.log(
    `✔ ${PUBLIC_HOLIDAYS.length} SA public holidays (⚠ verify before launch)`,
  );
}

main(adminPlan)
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
