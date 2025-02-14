import { toChunkIterator, toLines } from './src/main/ts/streamiter.ts';

type ProcSig = Deno.Signal;
type ProcStat = Deno.CommandStatus;

interface ProcessLike {
	kill(sig: ProcSig): void;
	readonly status: Promise<ProcStat>;
	readonly pid   : number|string;
	readonly name? : string;
}

function absMax(a: number, b: number): number {
	return Math.abs(a) > Math.abs(b) ? a : b;
}
function coalesce<T>(a: T | null, b: T | null): T | null {
	return a != null ? a : b;
}
function mergeStatus(a: ProcStat, b: ProcStat): ProcStat {
	return {
		success: a.success && b.success,
		code: absMax(a.code, b.code),
		signal: coalesce(a.signal, b.signal),
	};
}

class ProcessGroup implements ProcessLike {
	#children: ProcessLike[] = [];
	#pid : string;
	constructor(pid:string) {
		this.#pid = pid;
	}
	
	add(process: ProcessLike): void {
		this.#children.push(process);
	}
	
	kill(sig: Deno.Signal): void {
		console.log(`# Killing process group ${this.#pid} with signal ${sig}`);
		for (const process of this.#children) {
			console.log(`#   Killing child process ${process.pid}${process.name ? ' ('+process.name+')' : ''} with signal ${sig}`);
			process.kill(sig);
		}
	}
	
	async #getStatus() : Promise<ProcStat> {
		let status : ProcStat = { success: true, code: 0, signal: null };
		for (const child of this.#children) {
			const childStatus = await child.status;
			status = mergeStatus(status, childStatus);
		}
		return status;
	}
	
	get status(): Promise<ProcStat> {
		return this.#getStatus();
	}
	
	get pid(): string {
		return this.pid;
	}
}

let nextPseudoPid = 0;

function newPseudoPid() : string {
	return "PS:"+(nextPseudoPid++).toString();
}

function functionToProcessLike(fn: (signal:AbortSignal) => Promise<ProcStat>, opts: {name?:string, pid?:string} = {}): ProcessLike {
	const pid = opts.pid ?? newPseudoPid();
	const name = opts.name;
	const controller = new AbortController();
	const prom = fn(controller.signal);
	return {
		kill(sig: ProcSig) { controller.abort(sig); },
		get status() { return prom; },
		get pid() { return pid; },
		get name() { return name; },
	};
}

function main(args: string[]): ProcessGroup {
	const command = Deno.args.length > 0 ? Deno.args : ["bluetoothctl"];
	const cmd = new Deno.Command(command[0], {
		args: command.slice(1),
		stdin: "piped",
		stdout: "piped",
		stderr: "piped"
	});
	const process = cmd.spawn();
	const stdinWriter = process.stdin.getWriter();
	const stdoutReader = process.stdout.getReader();
	const stderrReader = process.stderr.getReader();
	
	const processGroup = new ProcessGroup(newPseudoPid());
	processGroup.add(process);
	
	const stdinProcess = functionToProcessLike(async (signal) => {
		const encoder = new TextEncoder();
		const stdinLines = toLines(Deno.stdin.readable);
		
		for await (const line of stdinLines) {
			if (signal.aborted) return { code: 1, success: false, signal: signal.reason };
			
			const trimmed = line.trim();
			if (trimmed === "" || trimmed.startsWith("#")) continue;
			
			if (trimmed === "kill") {
				console.log("# Killing process group...");
				processGroup.kill("SIGKILL");
				break;
			}
			if (trimmed === "exit") {
				console.log("# Exiting...");
				await stdinWriter.close();
				break;
			}
			
			const data = encoder.encode(trimmed + "\n");
			await stdinWriter.write(data);
		}
		return process.status;
	}, {name: "stdin-piper"});
	
	const stdoutProcess = functionToProcessLike(async (signal) => {
		signal.addEventListener("abort", () => stdoutReader.cancel());
		const stdoutLines = toLines(toChunkIterator(stdoutReader));
		for await (const line of stdoutLines) {
			if (signal.aborted) return { code: 1, success: false, signal: signal.reason };
			console.log(line);
		}
		return process.status;
	}, {name: "stdout-piper"});
	
	const stderrProcess = functionToProcessLike(async (signal) => {
		signal.addEventListener("abort", () => stderrReader.cancel());
		const stderrLines = toLines(toChunkIterator(stderrReader));
		for await (const line of stderrLines) {
			if (signal.aborted) return { code: 1, success: false, signal: signal.reason };
			console.error(line);
		}
		return { code: 0, success: true, signal: null };
	}, {name: "stderr-piper"});
	
	processGroup.add(stdinProcess);
	processGroup.add(stdoutProcess);
	processGroup.add(stderrProcess);
	
	processGroup.add(functionToProcessLike((signal) => {
		const processes : {[k:string]: ProcessLike} = {
			process: process,
			stdin: stdinProcess,
			stdout: stdoutProcess,
			stderr: stderrProcess,
		};
		const reportPromises = [];
		for( const key in processes ) {
			const proc = processes[key];
			reportPromises.push(proc.status.then(stat => { console.log(`# ${key} (${proc.pid}) done: ${JSON.stringify(stat)}`); }));
		}
		return Promise.all(reportPromises).then(() => ({ success: true, code: 0, signal: null }));
	}, {name: "exit-reporter"}));
	
	return processGroup;
}

// Top-level command-line interface
if (import.meta.main) {
	Deno.exit((await main(Deno.args).status).code);
}
