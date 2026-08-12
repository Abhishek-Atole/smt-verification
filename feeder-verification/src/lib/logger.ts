type Args = unknown[];

function formatArgs(args: Args) {
  return args.map((a) => {
    try {
      return typeof a === "string" ? a : JSON.stringify(a);
    } catch {
      return String(a);
    }
  });
}

export const logger = {
  info: (...args: Args) => console.info('[feeder-verification]', ...formatArgs(args)),
  warn: (...args: Args) => console.warn('[feeder-verification]', ...formatArgs(args)),
  error: (...args: Args) => console.error('[feeder-verification]', ...formatArgs(args)),
  debug: (...args: Args) => console.debug('[feeder-verification]', ...formatArgs(args)),
};

export default logger;
