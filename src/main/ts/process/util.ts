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

interface FunctionToProcessLikeOpts {
	name?:string,
	id?:string,
	// deno-lint-ignore no-explicit-any
	onError? : (error:any)=>number,
}

export function functionToProcessLike2<T extends ProcessLike>(
	procConstructor : (proc:ProcessLike) => T,
	fn: (this:T, signal:AbortSignal) => Promise<number>,
	opts: FunctionToProcessLikeOpts = {}
): T {
	const id = opts.id ?? newPseudoPid();
	const name = opts.name;
	const onErr = opts.onError;
	
	const proc : T = procConstructor({
		kill(sig: ProcSig) { controller.abort(sig); },
		wait() { return prom; },
		get id() { return id; },
		get name() { return name; },
	});

	const controller = new AbortController();
	let prom = fn.call(proc, controller.signal);
	if( onErr ) {
		prom = prom.catch( e => onErr(e) );
	} else {
		prom = prom.catch( e => {
			console.error(`Default error handler for ${name}: caught ${e}`);
			return 1;
		});
	}
	return proc;
}

export function functionToProcessLike(fn:(this:ProcessLike, signal:AbortSignal) => Promise<number>, opts:FunctionToProcessLikeOpts) {
	return functionToProcessLike2(p => p, fn, opts);
}
