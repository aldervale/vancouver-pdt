declare const __BC_COMMIT_SHA__: string;
declare const __BC_BUILD_TIME__: string;

/** Placeholder baked into local builds. A real deploy value replaces it. */
export const DEV_SHA = 'dev';
export const UNKNOWN_BUILD_TIME = 'unknown';

/**
 * Prefer a value baked at build time. Placeholders still lose to the
 * process environment so a staging machine can identify the running build.
 */
export function chooseBuildField(
	baked: string | undefined,
	runtime: string | undefined,
	unset: string
): string {
	if (baked && baked !== unset) return baked;
	if (runtime) return runtime;
	return baked || unset;
}

export function getBuildInfo(): { sha: string; builtAt: string } {
	const bakedSha = typeof __BC_COMMIT_SHA__ === 'string' ? __BC_COMMIT_SHA__ : undefined;
	const bakedTime = typeof __BC_BUILD_TIME__ === 'string' ? __BC_BUILD_TIME__ : undefined;
	return {
		sha: chooseBuildField(bakedSha, process.env.COMMIT_SHA, DEV_SHA),
		builtAt: chooseBuildField(bakedTime, process.env.BUILD_TIME, UNKNOWN_BUILD_TIME)
	};
}
