import type { RequestHandler } from '@sveltejs/kit';
import { deployedCommit, versionResponse } from '$lib/deployed-commit';

// Public on staging once the existing gateway skips auth for this path.
// The body is the deployed commit and nothing else.
export const GET: RequestHandler = () => versionResponse(deployedCommit());
