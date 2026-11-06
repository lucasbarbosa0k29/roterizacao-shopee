import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../lib/auth";
import AccountSecurityForm from "../components/AccountSecurityForm";
export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  if (!(session?.user as { id?: string } | undefined)?.id) redirect("/login");
  return <AccountSecurityForm mode="change" />;
}
