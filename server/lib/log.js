'use strict';
// Log strutturato su stdout/stderr (visibile nella console e nei log di deployment di Replit)
function fmt(level, msg, extra) {
  const line = { t: new Date().toISOString(), level, msg };
  if (extra instanceof Error) { line.error = extra.message; line.stack = extra.stack; }
  else if (extra) line.data = extra;
  return JSON.stringify(line);
}
module.exports = {
  info: (m, e) => console.log(fmt('info', m, e)),
  warn: (m, e) => console.warn(fmt('warn', m, e)),
  error: (m, e) => console.error(fmt('error', m, e)),
};
