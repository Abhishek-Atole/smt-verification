"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface BomOption {
  id: string;
  bomNumber: string;
  revision: string;
}

export default function NewChangeoverPage() {
  const router = useRouter();
  const [boms, setBoms] = useState<BomOption[]>([]);
  const [bomHeaderId, setBomHeaderId] = useState("");
  const [lineNumber, setLineNumber] = useState("");
  const [shift, setShift] = useState("MORNING");

  useEffect(() => {
    fetch("/api/bom")
      .then((res) => res.json())
      .then((data) => {
        setBoms(data.boms ?? []);
        if (data.boms?.[0]?.id) setBomHeaderId(data.boms[0].id);
      });
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    const res = await fetch("/api/changeovers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bomHeaderId,
        lineNumber,
        shift,
        idempotencyKey: crypto.randomUUID(),
      }),
    });

    const data = await res.json();
    if (res.ok) router.push(`/changeover/${data.changeover.id}`);
  };

  return (
    <form onSubmit={submit} className="max-w-xl space-y-4">
      <h1 className="text-xl font-semibold text-neutral-900">Create Changeover</h1>
      <label className="block text-sm text-neutral-700">
        BOM
        <select
          value={bomHeaderId}
          onChange={(event) => setBomHeaderId(event.target.value)}
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2"
          required
        >
          {boms.map((bom) => (
            <option key={bom.id} value={bom.id}>{`${bom.bomNumber} (${bom.revision})`}</option>
          ))}
        </select>
      </label>
      <label className="block text-sm text-neutral-700">
        Line Number
        <input
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2"
          value={lineNumber}
          onChange={(event) => setLineNumber(event.target.value)}
        />
      </label>
      <label className="block text-sm text-neutral-700">
        Shift
        <select value={shift} onChange={(event) => setShift(event.target.value)} className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2">
          <option value="MORNING">MORNING</option>
          <option value="EVENING">EVENING</option>
          <option value="NIGHT">NIGHT</option>
        </select>
      </label>
      <button type="submit" className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
        Start Changeover
      </button>
    </form>
  );
}
