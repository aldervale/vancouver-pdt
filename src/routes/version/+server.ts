import { json } from '@sveltejs/kit';
import { getBuildInfo } from '$lib/build-info';

/**
 * Public build identity. Staging's oauth2-proxy must skip auth for this
 * path; the deploy script adds that exception. The body is only the commit
 * and the build time.
 */
export function GET() {
	return json(getBuildInfo(), {
		headers: {
			'cache-control': 'no-store'
		}
	});
}
