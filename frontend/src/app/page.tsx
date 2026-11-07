import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { ApiUnavailable } from "@/components/api-unavailable";
import { ClassCard } from "@/components/class-card";
import { buttonGold, buttonPrimary, pageWrap } from "@/components/ui";
import { getWorkshops } from "@/lib/catalogue";

/** The hero is local photography, so it shows even while the API sleeps. */
const HERO = [
  {
    src: "/images/classes/kids-and-parents-paint-together.jpg",
    alt: "Children and parents holding up the bright paintings they made together.",
    width: 940,
    height: 470,
  },
  {
    src: "/images/classes/pakistani-woodblock-printing.jpg",
    alt: "Carved wooden printing blocks on fabric printed with teal flowers.",
    width: 940,
    height: 705,
  },
  {
    src: "/images/classes/shibori-workshop.jpg",
    alt: "Two guests holding up the indigo shibori cloths they dyed.",
    width: 940,
    height: 423,
  },
];

const PROMISES = [
  "Materials included",
  "No experience needed",
  "Ages 7+ welcome",
];

export default async function Home() {
  // Rendered per request, never at build time: CI builds with no API running.
  await connection();
  const workshops = await getWorkshops();

  return (
    <>
      <section className={`${pageWrap} grid items-center gap-10 py-12 md:grid-cols-[1.05fr_0.95fr] md:py-16`}>
        <div>
          <h1 className="font-display text-[clamp(2.6rem,6vw,4.3rem)] leading-[1.02] font-black text-balance text-plum">
            Make something
            <span className="block text-ochre">with your hands.</span>
          </h1>
          <p className="mt-5 max-w-[40ch] text-[1.15rem] text-body">
            Batik, shibori, block printing and painting — for grown-ups, for
            kids, and for the two of you together.
          </p>
          <ul className="mt-6 flex flex-wrap gap-2" aria-label="Every class">
            {PROMISES.map((p) => (
              <li
                key={p}
                className="rounded-full bg-lilac px-4 py-2 text-base font-semibold text-purple"
              >
                {p}
              </li>
            ))}
          </ul>
          <Link href="/classes" className={`${buttonPrimary} mt-8`}>
            Find a class
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {HERO.map((img, i) => (
            <Image
              key={img.src}
              src={img.src}
              alt={img.alt}
              width={img.width}
              height={img.height}
              priority={i === 0}
              sizes="(min-width: 768px) 25vw, 50vw"
              className={`aspect-square h-full w-full rounded-[18px] object-cover ${
                i === 0 ? "md:row-span-2 md:aspect-auto" : ""
              }`}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="classes-heading" className={`${pageWrap} pb-16`}>
        <div className="mb-8 text-center">
          <h2
            id="classes-heading"
            className="font-display text-[2.1rem] font-semibold text-plum"
          >
            Pick your class
          </h2>
          <p className="text-muted">In the studio in Sefton Park, or at home.</p>
        </div>
        {workshops.ok ? (
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {workshops.data.map((w) => (
              <li key={w.slug} className="flex">
                <ClassCard workshop={w} />
              </li>
            ))}
          </ul>
        ) : (
          <ApiUnavailable what="the classes" />
        )}
      </section>

      <section
        aria-labelledby="about-heading"
        className="on-dark bg-purple py-14 text-mist"
      >
        <div className={`${pageWrap} grid items-center gap-10 md:grid-cols-[0.8fr_1.2fr]`}>
          <Image
            src="/images/classes/batik-workshop.jpg"
            alt="A workshop group holding up the batik scarves they made."
            width={940}
            height={470}
            sizes="(min-width: 768px) 40vw, 100vw"
            className="aspect-square w-full rounded-[var(--radius-card)] object-cover"
          />
          <div>
            <h2
              id="about-heading"
              className="font-display text-[2rem] font-semibold text-gold"
            >
              Hello, I’m Rehana
            </h2>
            <p className="mt-4 text-[1.14rem] leading-relaxed">
              I’ve spent twenty years in textiles, as a fashion designer and as
              a university lecturer.
            </p>
            <p className="mt-3 text-[1.14rem] leading-relaxed">
              I’m the only artist teaching Indonesian batik in the Adelaide
              area, and I’d love to teach you.
            </p>
            <Link href="/classes" className={`${buttonGold} mt-7`}>
              Book a class
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
