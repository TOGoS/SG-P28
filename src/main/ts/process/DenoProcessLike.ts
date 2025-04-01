/// <reference lib="Deno.window"/>

import ProcessLike, { ProcSig } from './ProcessLike.ts';

export default class DenoProcessLike
implements ProcessLike
{
	#proc : Deno.ChildProcess;
	#name : string;
	#cleanup : () => Promise<void>;
	#cleanupPromise : Promise<void>|undefined;
	constructor(proc:Deno.ChildProcess, opts:{name?:string, cleanup?:()=>Promise<void>} = {}) {
		this.#proc = proc;
		this.#name = opts.name ?? `OS process ${proc.pid}`;
		this.#cleanup = opts.cleanup ?? (() => Promise.resolve());
	}
	
	get id(): string {
		return "" + this.#proc.pid;
	}
	get name(): string | undefined {
		return this.#name;
	}
	cleanup() : Promise<void> {
		this.#cleanupPromise ??= this.#cleanup();
		return this.#cleanupPromise;
	}
	async wait(): Promise<number> {
		const status = await this.#proc.status;
		await this.cleanup();
		return status.code;
	}
	kill(sig: ProcSig): void {
		this.#proc.kill(sig);
	}
}
