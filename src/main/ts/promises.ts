export const RESOLVED_PROMISE = Promise.resolve();
export function getResolvedPromise() { return RESOLVED_PROMISE; }
export function ignoreResult<T>(promise:Promise<T>) : Promise<void> {
	// Not sure if any danger to just:
	// return promise as Promise<unknown> as Promise<void>;
	return promise.then(getResolvedPromise);
}
export function mkPromiseChain<T>(subject:T) : <R>(action:(subject:T) => Promise<R>) => Promise<R> {
	let queue : Promise<unknown> = Promise.resolve();
	return <R>(action:(subject:T) => Promise<R>) => {
		return (queue = queue.then(() => action(subject))) as Promise<R>;
	};
}
