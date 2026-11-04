/** Preserve the gateway's runtime identity while replacing only app files. */
import assert from 'node:assert/strict';

// Inspect only launch metadata, never image environment values.
export const runtimeConfigFormat = '{"User":{{json .Config.User}},"Entrypoint":{{json .Config.Entrypoint}},"Cmd":{{json .Config.Cmd}},"WorkingDir":{{json .Config.WorkingDir}}}';

export function overlayRuntimeUser(config) {
  assert(typeof config?.User === 'string', 'Cannot determine the gateway image user');
  if (config.User === '') return '0'; // Docker's empty default also means root.
  const part = '(?:[0-9]+|[a-zA-Z_][a-zA-Z0-9_.-]*)';
  assert(config.User.length <= 128 && new RegExp(`^${part}(?::${part})?$`).test(config.User),
    'Gateway image user is not a supported literal user/group');
  return config.User;
}

export function assertGatewayImageConfigPreserved(before, after) {
  assert(after?.User === overlayRuntimeUser(before), 'Overlay changed the gateway runtime user');
  for (const key of ['Entrypoint', 'Cmd', 'WorkingDir']) {
    assert(JSON.stringify(before[key]) === JSON.stringify(after[key]), `Overlay changed gateway ${key}`);
  }
}
