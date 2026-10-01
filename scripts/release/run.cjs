const { spawnSync } = require('node:child_process');
const path = require('node:path');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status ?? result.signal})`);
  return result;
}
module.exports = { run };
