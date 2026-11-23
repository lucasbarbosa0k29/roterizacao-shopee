import { requireSuperAdmin } from "./admin-roles";

export const canBroadcastNotifications = requireSuperAdmin;
