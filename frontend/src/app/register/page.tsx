import type { Metadata } from "next";
import { AuthCard } from "@/components/auth-card";
import { RegisterForm } from "@/components/auth-forms";

export const metadata: Metadata = {
  title: "Create your account",
  robots: { index: false },
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <AuthCard
      title="Create your account"
      lede="So you can see your bookings and book faster next time."
    >
      <RegisterForm next={next} />
    </AuthCard>
  );
}
