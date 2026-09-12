/**
 * Seeds the six classes agreed for the initial build (ADR-020), the client's
 * refund policy (ADR-014) and a South Australian public-holiday calendar.
 *
 * Idempotent — safe to run repeatedly. `npm run db:seed`.
 */
import { DeliveryMode, PrismaClient, ProductType, Role, WorkshopStatus } from '@prisma/client';
import * as argon2 from 'argon2';

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
  "batik-workshop":
    "Welcome to Studio Rags! Let's Batik to try the amazing cultural heritage of Indonesian fabric printing art. Enjoy a relaxing creative day.",
  "shibori-workshop":
    "It's the perfect time to make some cool Indigo Shibori  pieces and create a new look both in your wardrobe and interiors !",
  "pakistani-woodblock-printing":
    "Explore the ancient art of Block printing from the Indus Valley Civilization and create stunning fabrics for your projects or wardrobe.",
  "batik-online":
    "Learn the amazing Indonesian Batik printing at home and reboot your Positive energy with an immersive unique art!",
  "shibori-online":
    "Relax & re-energise your spirits through this Shibori dyeing kit and online class!",
  "kids-and-parents-paint-together":
    "Learn painting in this family friendly class. Cherish your bonding and paint a sweet memory together !",
};

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
  },
  {
    slug: 'kids-and-parents-paint-together',
    title: 'Kids and Parents Paint Together',
    priceCents: 4200,
    productType: ProductType.KIDS,
    deliveryMode: DeliveryMode.IN_PERSON,
    durationMinutes: 90,
    // Counts CHILDREN, not people — every child brings an adult (ADR-016).
    defaultCapacity: 6,
    minAge: 7,
    maxAge: 15,
    requiresAccompanyingAdult: true,
    sortOrder: 6,
  },
] as const;

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

/** A few future dates per workshop, so the catalogue has something to show. */
function upcomingDates(count: number, startOffsetDays: number, everyDays: number) {
  const dates: Date[] = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date();
    d.setUTCHours(0, 30, 0, 0); // 10:00 Adelaide, near enough for seed data
    d.setUTCDate(d.getUTCDate() + startOffsetDays + i * everyDays);
    dates.push(d);
  }
  return dates;
}

async function main() {
  // ── Refund policy ─────────────────────────────────────────────────────────
  const existingPolicy = await prisma.refundPolicy.findFirst({ where: { isDefault: true } });
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
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@studiorags.com.au').toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe-Studio2026';

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { role: Role.ADMIN },
    create: {
      email: adminEmail,
      passwordHash: await argon2.hash(adminPassword, { type: argon2.argon2id }),
      firstName: 'Rehana',
      lastName: 'Usman',
      role: Role.ADMIN,
      emailVerifiedAt: new Date(),
    },
  });
  console.log(`✔ admin: ${adminEmail}`);
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.log('  ⚠ using the default development password — never seed production with it');
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
          'requiresAccompanyingAdult' in w ? w.requiresAccompanyingAdult : false,
        sortOrder: w.sortOrder,
        refundPolicyId: policy.id,
      },
    });

    const existingSessions = await prisma.session.count({ where: { workshopId: workshop.id } });
    if (existingSessions === 0) {
      for (const startsAt of upcomingDates(3, 14, 14)) {
        const endsAt = new Date(startsAt.getTime() + w.durationMinutes * 60_000);
        await prisma.session.create({
          data: {
            workshopId: workshop.id,
            startsAt,
            endsAt,
            capacity: w.defaultCapacity,
            location:
              w.deliveryMode === DeliveryMode.IN_PERSON ? 'Studio Rags, Sefton Park SA' : null,
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
  console.log(`✔ ${PUBLIC_HOLIDAYS.length} SA public holidays (⚠ verify before launch)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
