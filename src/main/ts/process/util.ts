import ProcessLike, { ProcSig } from "./ProcessLike.ts";

export const EXITCODE_ABORTED = 137; // 'I've been sigkilled'

export function absMax(a: number, b: number): number {
	return Math.abs(a) > Math.abs(b) ? a : b;
}
export function combineExitCodes(codes: number[]): number {
	return codes.reduce(absMax, 0);
}

let nextPseudoPid = 0;

export function newPseudoPid() : string {
	return "pseudoproc:"+(nextPseudoPid++).toString();
}

export function functionToProcessLike(fn: (signal:AbortSignal) => Promise<number>, opts: {name?:string, id?:string} = {}): ProcessLike {
	const id = opts.id ?? newPseudoPid();
	const name = opts.name;
	const controller = new AbortController();
	const prom = fn(controller.signal);
	return {
		kill(sig: ProcSig) { controller.abort(sig); },
		wait() { return prom; },
		get id() { return id; },
		get name() { return name; },
	};
}
