import ProcessLike from "./ProcessLike.ts";
import { combineExitCodes, newPseudoPid } from './util.ts';

export class ProcessGroup implements ProcessLike {
	#children: ProcessLike[] = [];
	#id : string;
	constructor(opts : {children? : ProcessLike[], id?:string} = {}) {
		this.#children = opts.children ?? [];
		this.#id = opts.id ?? newPseudoPid();
	}
	kill(sig: Deno.Signal): void {
		console.log(`# Killing process group ${this.#id} with signal ${sig}`);
		for (const process of this.#children) {
			console.log(`#   Killing child process ${process.id}${process.name ? ' ('+process.name+')' : ''} with signal ${sig}`);
			process.kill(sig);
		}
	}
	
	wait() : Promise<number> {
		return Promise.all(this.#children.map(child => child.wait())).then(combineExitCodes);
	}
	
	get id(): string {
		return this.id;
	}
}
