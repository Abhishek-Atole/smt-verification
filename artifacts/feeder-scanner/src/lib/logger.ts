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
  info: (...args: Args) => console.info('[app]', ...formatArgs(args)),
  warn: (...args: Args) => console.warn('[app]', ...formatArgs(args)),
  error: (...args: Args) => console.error('[app]', ...formatArgs(args)),
  debug: (...args: Args) => console.debug('[app]', ...formatArgs(args)),
};

export default logger;
