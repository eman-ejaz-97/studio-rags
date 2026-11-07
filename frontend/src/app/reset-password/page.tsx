import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { ResetPasswordForm } from "@/components/auth-forms";
import { buttonPrimary } from "@/components/ui";

export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false },
  // The token in the URL is a live credential: never send it on to another site.
  referrer: "no-referrer",
};

/** The emailed link lands here as /reset-password?token=… */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) {
    return (
      <AuthCard
        title="This link is incomplete"
        lede="The reset link is missing part of its address. Ask for a new one and use the link exactly as it arrives."
      >
        <Link href="/forgot-password" className={`${buttonPrimary} w-full`}>
          Ask for a new link
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Choose a new password">
      <ResetPasswordForm token={token} />
    </AuthCard>
  );
}
