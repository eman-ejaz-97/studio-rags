import type { Metadata } from "next";
import Link from "next/link";
import { ApiUnavailable } from "@/components/api-unavailable";
import { ClassCard } from "@/components/class-card";
import { pageWrap } from "@/components/ui";
import { getWorkshops } from "@/lib/catalogue";
import {
  CLASS_TYPES,
  type ClassType,
  parseClassType,
} from "@/lib/catalogue-types";

export const metadata: Metadata = {
  title: "Classes",
  description:
    "Batik, shibori, woodblock printing and family painting classes in Sefton Park, Adelaide, and online.",
};

export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;
  const selected = parseClassType(type);
  const workshops = await getWorkshops();

  const shown = workshops.ok
    ? workshops.data.filter(
        (w) => !selected || w.productType === CLASS_TYPES[selected].productType,
      )
    : [];

  return (
    <div className={`${pageWrap} py-12`}>
      <h1 className="font-display text-[clamp(2.2rem,5vw,3.2rem)] leading-tight font-black text-plum">
        {selected ? CLASS_TYPES[selected].label : "All classes"}
      </h1>
      <p className="mt-2 max-w-[60ch] text-[1.1rem] text-body">
        Every class includes your materials, and no experience is needed.
      </p>

      <nav aria-label="Filter classes" className="mt-6">
        <ul className="flex flex-wrap gap-2">
          <FilterLink type={null} selected={selected} label="All" />
          {(Object.keys(CLASS_TYPES) as ClassType[]).map((t) => (
            <FilterLink
              key={t}
              type={t}
              selected={selected}
              label={CLASS_TYPES[t].label}
            />
          ))}
        </ul>
      </nav>

      <div className="mt-8">
        {!workshops.ok ? (
          <ApiUnavailable what="the classes" />
        ) : shown.length === 0 ? (
          <p className="text-muted">No classes of this kind are listed yet.</p>
        ) : (
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((w) => (
              <li key={w.slug} className="flex">
                <ClassCard workshop={w} headingLevel={2} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FilterLink({
  type,
  selected,
  label,
}: {
  type: ClassType | null;
  selected: ClassType | null;
  label: string;
}) {
  const current = type === selected;
  return (
    <li>
      <Link
        href={type ? `/classes?type=${type}` : "/classes"}
        aria-current={current ? "page" : undefined}
        className={`inline-flex min-h-11 items-center rounded-full border-2 px-4 font-semibold ${
          current
            ? "border-purple bg-purple text-white"
            : "border-line bg-card text-purple hover:border-purple"
        }`}
      >
        {label}
      </Link>
    </li>
  );
}
