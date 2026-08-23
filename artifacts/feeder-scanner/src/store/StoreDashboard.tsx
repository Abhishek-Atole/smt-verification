import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Package } from "lucide-react";
import { useAuth } from "@/context/auth-context";

// Placeholder store dashboard. Store/material-inward features are not built
// yet, so store users land here after login with a "coming soon" note rather
// than any fabricated inventory controls.
export default function StoreDashboard() {
  const { user } = useAuth();

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <Card className="w-full max-w-xl border-border">
        <CardHeader className="text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Package className="w-7 h-7 text-primary" />
          </div>
          <CardTitle className="text-2xl">Store Dashboard</CardTitle>
          <CardDescription className="mt-2">
            {user ? `Signed in as ${user.name}. ` : null}Store and material-inward features are coming soon.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center text-sm text-muted-foreground">
          You will see store controls here once the module unlocks.
        </CardContent>
      </Card>
    </div>
  );
}
