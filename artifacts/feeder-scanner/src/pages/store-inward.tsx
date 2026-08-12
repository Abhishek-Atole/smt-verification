import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Package } from "lucide-react";
import { useAuth } from "@/context/auth-context";

// Phase 2-B placeholder. The real solder-paste inward form lands when the
// Solder Paste FIFO module unlocks (see PRD §2.3 and the "Coming Soon"
// module list). The page exists today so store users land somewhere usable
// after login instead of an empty dashboard they don't have access to.
export default function StoreInward() {
  const { user } = useAuth();

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <Card className="w-full max-w-xl border-border">
        <CardHeader className="text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Package className="w-7 h-7 text-primary" />
          </div>
          <CardTitle className="text-2xl">Solder Paste Inward</CardTitle>
          <CardDescription className="mt-2">
            {user ? `Signed in as ${user.name}.` : null} The inward registration form ships with the Solder Paste FIFO module.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center text-sm text-muted-foreground">
          You will see scan + register controls here once the module unlocks.
        </CardContent>
      </Card>
    </div>
  );
}
