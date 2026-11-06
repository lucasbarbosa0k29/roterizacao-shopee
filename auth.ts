// Compatibility entry point: every NextAuth handler uses the same v4 security policy.
import NextAuth from "next-auth";
import { authOptions } from "@/app/lib/auth";

export { authOptions };
export default NextAuth(authOptions);
