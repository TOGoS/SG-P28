import { toChunkIterator, toLines } from './src/main/ts/streamiter.ts';

type ProcSig = Deno.Signal;
type ProcStat = Deno.CommandStatus;
type ProcessID = string;

type ProcessLike = {
	kill(sig: ProcSig): void;
	readonly id    : ProcessID;
	readonly name? : string;
	wait() : Promise<number>;
}

const EXITCODE_ABORTED = 137; // 'I've been sigkilled'

function absMax(a: number, b: number): number {
	return Math.abs(a) > Math.abs(b) ? a : b;
}
function combineExitCodes(codes: number[]): number {
	return codes.reduce(absMax, 0);
}

class ProcessGroup implements ProcessLike {
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

class DenoProcessLike implements ProcessLike {
	#process: Deno.ChildProcess;
	#name: string;
	constructor(process: Deno.ChildProcess, opts: {name?:string} = {}) {
		this.#process = process;
		this.#name = opts.name ?? "";
	}
	kill(sig: Deno.Signal): void {
		this.#process.kill(sig);
	}
	wait() : Promise<number> {
		return this.#process.status.then(stat => stat.code);
	}
	get id(): string { return "sysproc:"+this.#process.pid; }
	get name(): string { return this.#name; }
}

let nextPseudoPid = 0;

function newPseudoPid() : string {
	return "pseudoproc:"+(nextPseudoPid++).toString();
}

function functionToProcessLike(fn: (signal:AbortSignal) => Promise<number>, opts: {name?:string, id?:string} = {}): ProcessLike {
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

function spawnBluetoothCtlCtl(args: string[]): ProcessGroup {
	const command = args.length > 0 ? args : ["bluetoothctl"];
	const cmd = new Deno.Command(command[0], {
		args: command.slice(1),
		stdin: "piped",
		stdout: "piped",
		stderr: "piped"
	});
	const sysProc = cmd.spawn();
	const stdinReader = Deno.stdin.readable.getReader();
	const procStdinWriter = sysProc.stdin.getWriter();
	const stdoutReader = sysProc.stdout.getReader();
	const stderrReader = sysProc.stderr.getReader();
	
	const mainProcess = new DenoProcessLike(sysProc);
	
	const abortController = new AbortController();
	
	// Hmm, stdin maybe shouldn't be part of the process group.
	// It is getting awkward to act both as a process in the group,
	// and as the thing reading from Deno.stdin, due to all the different
	// ways that it might need to be stopped or exit normally.
	const stdinAbortController = new AbortController();
	abortController.signal.addEventListener("abort", () => stdinAbortController.abort());
	stdinAbortController.signal.addEventListener("abort", () => stdinReader.cancel());
	const stdinProcess = functionToProcessLike(async (signal) => {
		const encoder = new TextEncoder();
		signal.addEventListener("abort", () => stdinReader.cancel());

		for await (const line of toLines(toChunkIterator(stdinReader))) {
			if (signal.aborted) return 1;
			
			const trimmed = line.trim();
			if (trimmed === "" || trimmed.startsWith("#")) continue;
			
			// A few different ways to quit:
			// - kill will forcibly kill the group and should result in a nonzero exit code
			// - exit will close stdin and should result in a zero exit code
			
			if (trimmed === "kill") {
				console.log("# Killing process group...");
				abortController.abort("kill command entered");
				break;
			}
			if (trimmed === "exit") {
				console.log("# Exiting...");
				await procStdinWriter.close();
				break;
			}
			
			const data = encoder.encode(trimmed + "\n");
			await procStdinWriter.write(data);
		}
		return 0;
	}, {name: "stdin-piper"});
	mainProcess.wait().then(() => stdinAbortController.abort());
	
	const stdoutProcess = functionToProcessLike(async (signal) => {
		signal.addEventListener("abort", () => stdoutReader.cancel());
		const stdoutLines = toLines(toChunkIterator(stdoutReader));
		for await (const line of stdoutLines) {
			if (signal.aborted) return EXITCODE_ABORTED;
			console.log(line);
		}
		return 0;
	}, {name: "stdout-piper"});
	
	const stderrProcess = functionToProcessLike(async (signal) => {
		signal.addEventListener("abort", () => stderrReader.cancel());
		const stderrLines = toLines(toChunkIterator(stderrReader));
		for await (const line of stderrLines) {
			if (signal.aborted) return EXITCODE_ABORTED;
			console.error(line);
		}
		return 0;
	}, {name: "stderr-piper"});
	
	const exitReporter = functionToProcessLike(_sig => {
		const processes : {[k:string]: ProcessLike} = {
			process: mainProcess,
			stdin: stdinProcess,
			stdout: stdoutProcess,
			stderr: stderrProcess,
		};
		const reportPromises = [];
		for( const key in processes ) {
			const proc = processes[key];
			reportPromises.push(proc.wait().then(stat => { console.log(`# ${key} (${proc.id}) done: ${JSON.stringify(stat)}`); }));
		}
		return Promise.all(reportPromises).then(() => 0);
	}, {name: "exit-reporter"});
	
	const pg = new ProcessGroup({id: newPseudoPid(), children: [mainProcess, stdinProcess, stdoutProcess, stderrProcess, exitReporter]});
	abortController.signal.addEventListener("abort", () => pg.kill("SIGKILL"));
	return pg;
}

if (import.meta.main) {
	spawnBluetoothCtlCtl(Deno.args).wait().then(c => {
		console.log(`# Main process group done: ${c}`);
		Deno.exit(c);
	});
}
