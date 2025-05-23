import ProcessLike from "./ProcessLike.ts";
import { combineExitCodes, newPseudoPid } from './util.ts';

export class ProcessGroup implements ProcessLike {
	#children: ProcessLike[] = [];
	#id : string;
	#exitCode : number|undefined;
	constructor(opts : {children? : ProcessLike[], id?:string} = {}) {
		this.#children = opts.children ?? [];
		this.#id = opts.id ?? newPseudoPid();
	}
	addChild(process : ProcessLike) : void {
		this.#children.push(process);
	}
	/**
	 * Kill the group and all children, forcing the group to exit
	 * with the specified code, regardless of child process exit codes.
	 **/
	exit(code : number): void {
		this.#exitCode = code;
		this.kill("SIGTERM");
	}
	kill(sig: Deno.Signal): void {
		console.log(`# Killing process group ${this.#id} with signal ${sig}`);
		for (const process of this.#children) {
			console.log(`#   Killing child process ${process.id}${process.name ? ' ('+process.name+')' : ''} with signal ${sig}`);
			process.kill(sig);
		}
	}
	
	/*
	 * May be overridden to clean up any additional resources this
	 * process group holds after all children have exited, and before wait() returns.
	 */
	dispose() : Promise<void> { return Promise.resolve(); }
	
	async wait() : Promise<number> {
		const code = await Promise.all(this.#children.map(child => child.wait())).then(childExitCodes => {
			return this.#exitCode ?? combineExitCodes(childExitCodes);
		})
		await this.dispose();
		return code;
	}
	
	get id(): string {
		return this.id;
	}
}
