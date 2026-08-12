"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

export default function LoginPage() {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const result = await signIn("credentials", {
      redirect: false,
      employeeId,
      password,
      callbackUrl: "/dashboard",
    });

    setLoading(false);

    if (!result || result.error) {
      setError("Invalid employee ID");
      return;
    }

    router.push(result.url ?? "/dashboard");
    router.refresh();
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-md items-center px-6">
      <form onSubmit={onSubmit} className="w-full space-y-4 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-neutral-900">Shift Login</h1>
        <label className="block text-sm text-neutral-700">
          Employee ID
          <input
            type="text"
            autoComplete="username"
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2"
            value={employeeId}
            onChange={(event) => setEmployeeId(event.target.value)}
            required
          />
        </label>
        <label className="block text-sm text-neutral-700">
          Password (optional)
          <input
            type="password"
            autoComplete="current-password"
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </form>
    </div>
  );
}
