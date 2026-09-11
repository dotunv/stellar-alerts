import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: "Magic Link",
      credentials: {
        token: { label: "Verification Token", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.token) return null;

        if (credentials.token === process.env.MAGIC_LINK_SECRET) {
          return { id: "1", email: "user@example.com" };
        }

        return null;
      },
    }),
  ],
  pages: {
    signIn: "/verify",
  },
  session: {
    strategy: "jwt",
  },
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
