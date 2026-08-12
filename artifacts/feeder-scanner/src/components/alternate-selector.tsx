// @ts-nocheck
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, CheckCircle2 } from "lucide-react";

export interface ComponentOption {
  id: number;
  mpn?: string;
  partNumber: string;
  manufacturer?: string;
  packageSize?: string;
  cost?: string;
  leadTime?: number;
  description?: string;
  isAlternate?: boolean;
}

interface AlternateSelectorProps {
  feederNumber: string;
  primaryOptions: ComponentOption[];
  alternateOptions: ComponentOption[];
  selectedId?: number;
  onSelect: (itemId: number) => void;
  isLoading?: boolean;
}

export function AlternateSelector({
  feederNumber,
  primaryOptions,
  alternateOptions,
  selectedId,
  onSelect,
  isLoading = false,
}: AlternateSelectorProps) {
  if (primaryOptions.length === 0 && alternateOptions.length === 0) {
    return null;
  }

  const hasAlternatives = alternateOptions.length > 0;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h3 className="font-bold text-sm font-mono uppercase">
          {feederNumber} — Available Components
        </h3>
        <p className="text-xs text-muted-foreground font-mono">
          {hasAlternatives 
            ? `${primaryOptions.length} primary + ${alternateOptions.length} alternate(s)` 
            : `${primaryOptions.length} component(s)`}
        </p>
      </div>

      {/* Primary Components */}
      {primaryOptions.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-muted-foreground uppercase font-mono">PRIMARY</p>
          <div className="space-y-2">
            {primaryOptions.map((option) => (
              <button
                key={option.id}
                onClick={() => onSelect(option.id)}
                disabled={isLoading}
                className={`w-full text-left p-3 rounded-sm border-2 transition-colors ${
                  selectedId === option.id
                    ? "border-green-500 bg-green-50 dark:bg-green-950/20"
                    : "border-border hover:border-green-500/50 bg-secondary/30 hover:bg-secondary/50"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold font-mono text-sm flex items-center gap-2">
                      {option.partNumber}
                      {selectedId === option.id && (
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                      )}
                    </div>
                    {option.mpn && (
                      <div className="text-xs text-muted-foreground font-mono mt-1">
                        MPN: {option.mpn}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground font-mono mt-1 flex flex-wrap gap-2">
                      {option.manufacturer && <span>{option.manufacturer}</span>}
                      {option.packageSize && <span>PKG: {option.packageSize}</span>}
                      {option.cost && <span>${option.cost}</span>}
                      {option.leadTime && <span>{option.leadTime}d lead</span>}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Alternate Components */}
      {alternateOptions.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-orange-600 dark:text-orange-400 uppercase font-mono flex items-center gap-2">
            <AlertCircle className="w-3 h-3" />
            Alternates
          </p>
          <div className="space-y-2">
            {alternateOptions.map((option) => (
              <button
                key={option.id}
                onClick={() => onSelect(option.id)}
                disabled={isLoading}
                className={`w-full text-left p-3 rounded-sm border-2 transition-colors ${
                  selectedId === option.id
                    ? "border-orange-500 bg-orange-50 dark:bg-orange-950/20"
                    : "border-orange-200 dark:border-orange-900 hover:border-orange-500/50 bg-orange-50/30 dark:bg-orange-950/10 hover:bg-orange-50/50"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold font-mono text-sm text-orange-700 dark:text-orange-300 flex items-center gap-2">
                      {option.partNumber}
                      {selectedId === option.id && (
                        <CheckCircle2 className="w-4 h-4 text-orange-600" />
                      )}
                    </div>
                    {option.mpn && (
                      <div className="text-xs text-muted-foreground font-mono mt-1">
                        MPN: {option.mpn}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground font-mono mt-1 flex flex-wrap gap-2">
                      {option.manufacturer && <span>{option.manufacturer}</span>}
                      {option.packageSize && <span>PKG: {option.packageSize}</span>}
                      {option.cost && <span>${option.cost}</span>}
                      {option.leadTime && <span>{option.leadTime}d lead</span>}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
