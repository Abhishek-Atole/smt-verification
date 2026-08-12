import pino from "pino";

const transport = (pino as any).transport
  ? (pino as any).transport({
      target: "pino-pretty",
      options: { colorize: true, translateTime: 'SYS:standard' },
    })
  : undefined;

const logger = pino({ level: process.env.LOG_LEVEL || "info" }, transport as any);

export default logger;
