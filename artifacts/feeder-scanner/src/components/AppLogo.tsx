import { appConfig } from "@/lib/appConfig";
import { useState } from "react";

type AppLogoProps = {
  className?: string;
};

export function AppLogo({ className }: AppLogoProps) {
  const [imageFailed, setImageFailed] = useState(false);

  if (appConfig.logoUrl && !imageFailed) {
    return (
      <img
        src={appConfig.logoUrl}
        alt={appConfig.companyShort}
        className={className}
        style={{ objectFit: "contain" }}
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <div
      className={className}
      style={{
        background: "#1A3557",
        borderRadius: "6px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 12px",
        color: "#fff",
        fontWeight: 700,
        letterSpacing: "0.05em",
        whiteSpace: "nowrap",
      }}
    >
      {appConfig.companyShort}
    </div>
  );
}
