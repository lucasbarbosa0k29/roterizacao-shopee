import { getServerSession } from "next-auth";
import { notFound } from "next/navigation";
import { authOptions } from "@/app/lib/auth";
import { requireAdmin } from "@/app/lib/admin-roles";
import { canBroadcastNotifications } from "@/app/lib/notification-admin";
import NotificationCampaigns from "./NotificationCampaigns";

export default async function AdminNotificationsPage() {
  const user = (await getServerSession(authOptions))?.user;
  if (!user?.id || !requireAdmin(user)) notFound();

  return <NotificationCampaigns canBroadcast={canBroadcastNotifications(user)} />;
}
