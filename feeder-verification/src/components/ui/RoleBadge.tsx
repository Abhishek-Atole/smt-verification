import { Badge } from "@/components/ui/Badge";

const ROLE_STYLE: Record<string, string> = {
  operator: "Operator",
  qa: "QA",
  engineer: "Engineer",
  admin: "Admin",
};

export function RoleBadge({ role }: { role: string }) {
  return <Badge>{ROLE_STYLE[role] ?? role}</Badge>;
}
