import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const LoginSchema = z.object({
  employeeId: z.string().min(1),
  password: z.string().optional(),
});

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  providers: [
    CredentialsProvider({
      name: "Employee ID",
      credentials: {
        employeeId: { label: "Employee ID", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = LoginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const normalizedEmployeeId = parsed.data.employeeId.trim().toUpperCase();
        if (!normalizedEmployeeId) return null;

        const user = await prisma.user.findFirst({
          where: {
            employeeId: {
              equals: normalizedEmployeeId,
              mode: "insensitive",
            },
            isActive: true,
          },
          select: {
            id: true,
            name: true,
            role: true,
            employeeId: true,
          },
        });

        if (!user) return null;

        return {
          id: user.id,
          name: user.name,
          role: user.role,
          employeeId: user.employeeId,
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60,
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role: string }).role;
        token.employeeId = (user as { employeeId: string }).employeeId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.id ?? "");
        session.user.role = String(token.role ?? "operator");
        session.user.employeeId = String(token.employeeId ?? "");
      }
      return session;
    },
  },
};
