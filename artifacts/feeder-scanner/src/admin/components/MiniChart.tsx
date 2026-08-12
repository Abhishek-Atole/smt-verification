import { useRef, useEffect } from "react";

interface Props {
  data: number[];
  color?: string;
  type?: "bar" | "line";
  height?: number;
  width?: number;
}

export default function MiniChart({
  data, color = "#00d4ff", type = "line", height = 32, width = 80,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const max = Math.max(...data, 1);
    const pad = 2;

    if (type === "bar") {
      const barW = (width - pad * 2) / data.length;
      ctx.fillStyle = color;
      data.forEach((v, i) => {
        const barH = (v / max) * (height - pad * 2);
        ctx.fillRect(pad + i * barW, height - pad - barH, Math.max(1, barW - 1), barH);
      });
    } else {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      data.forEach((v, i) => {
        const x = pad + (i / (data.length - 1)) * (width - pad * 2);
        const y = height - pad - ((v / max) * (height - pad * 2));
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }, [data, color, type, height, width]);

  return <canvas ref={canvasRef} style={{ width, height, borderRadius: 4 }} />;
}
