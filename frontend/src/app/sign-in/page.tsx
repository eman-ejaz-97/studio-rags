import type { Metadata } from "next";
import { AuthCard } from "@/components/auth-card";
import { SignInForm } from "@/components/auth-forms";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false },
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string }>;
}) {
  const { next, reset } = await searchParams;
  return (
    <AuthCard title="Welcome back" lede="Sign in to see your bookings and book a new class.">
      <SignInForm next={next} passwordChanged={reset === "1"} />
    </AuthCard>
  );
}
