declare const __BC_COMMIT_SHA__: string;

function bakedCommit(): string {
  return typeof __BC_COMMIT_SHA__ === 'string' ? __BC_COMMIT_SHA__ : '';
}

/** Commit baked into this build, or COMMIT_SHA when the build used the dev placeholder. */
export function deployedCommit(): string {
  const baked = bakedCommit();
  if (baked && baked !== 'dev') return baked;
  if (process.env.COMMIT_SHA) return process.env.COMMIT_SHA;
  return baked || 'dev';
}

/** Public /version body. The only field is the deployed commit. */
export function versionPayload(commit: string): { commit: string } {
  if (!/^[0-9a-f]{40}$/.test(commit) && commit !== 'dev') {
    throw new Error('commit must be the deployed git sha');
  }
  return { commit };
}

export function versionResponse(commit: string): Response {
  return new Response(JSON.stringify(versionPayload(commit)), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}
