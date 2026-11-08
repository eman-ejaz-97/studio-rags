import type { Metadata } from "next";
import { AccountPanel } from "@/components/account";
import { pageWrap } from "@/components/ui";

export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false },
};

export default function AccountPage() {
  return (
    <div className={`${pageWrap} py-12`}>
      <AccountPanel />
    </div>
  );
}
