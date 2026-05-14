const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const COLORS = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };
const RESET = '\x1b[0m';

let minLevel = LEVELS[process.env.LOG_LEVEL || 'info'] ?? LEVELS.info;

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function log(level, ...args) {
  if (LEVELS[level] < minLevel) return;
  const prefix = `${COLORS[level]}[${timestamp()}] [${level.toUpperCase()}]${RESET}`;
  console[level === 'error' ? 'error' : 'log'](prefix, ...args);
}

export const logger = {
  debug: (...args) => log('debug', ...args),
  info:  (...args) => log('info', ...args),
  warn:  (...args) => log('warn', ...args),
  error: (...args) => log('error', ...args),
  setLevel(level) { minLevel = LEVELS[level] ?? LEVELS.info; },
};
