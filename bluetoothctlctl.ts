import { toLines } from './src/main/ts/streamiter.ts';

type ProcSig = Deno.Signal;
type ProcStat = Deno.CommandStatus;

interface ProcessLike {
	kill(sig: ProcSig): void;
	get status(): Promise<ProcStat>;
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
	private children: ProcessLike[] = [];
	
	add(process: ProcessLike): void {
		this.children.push(process);
	}
	
	kill(sig: Deno.Signal): void {
		for (const process of this.children) {
			process.kill(sig);
		}
	}
	
	async #getStatus() : Promise<ProcStat> {
		let status : ProcStat = { success: true, code: 0, signal: null };
		for (const child of this.children) {
			const childStatus = await child.status;
			status = mergeStatus(status, childStatus);
		}
		return status;
	}
	
	get status(): Promise<ProcStat> {
		return this.#getStatus();
	}
}

function functionToProcessLike(fn: (signal:AbortSignal) => Promise<ProcStat>): ProcessLike {
	const controller = new AbortController();
	const prom = fn(controller.signal);
	return {
		kill(sig: ProcSig) {
			controller.abort();
		},
		get status() {
			return prom;
		},
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
	const stdout = process.stdout;
	const stderr = process.stderr;
	
	const processGroup = new ProcessGroup();
	processGroup.add(process);
	
	const stdinProcess = functionToProcessLike(async (signal) => {
		const encoder = new TextEncoder();
		const stdinLines = toLines(Deno.stdin.readable);
		
		for await (const line of stdinLines) {
			if (signal.aborted) break;
			const trimmed = line.trim();
			if (trimmed === "" || trimmed.startsWith("#")) continue;
			
			if (trimmed === "exit") {
				console.log("Exiting...");
				await stdinWriter.close();
				break;
			}
			
			const data = encoder.encode(trimmed + "\n");
			await stdinWriter.write(data);
		}
		return process.status;
	});
	
	const stdoutProcess = functionToProcessLike(async (signal) => {
		const stdoutLines = toLines(stdout);
		for await (const line of stdoutLines) {
			if (signal.aborted) break;
			console.log(line);
		}
		return process.status;
	});
	
	const stderrProcess = functionToProcessLike(async (signal) => {
		const stderrLines = toLines(stderr);
		for await (const line of stderrLines) {
			if (signal.aborted) break;
			console.error(line);
		}
		return process.status;
	});
	
	processGroup.add(stdinProcess);
	processGroup.add(stdoutProcess);
	processGroup.add(stderrProcess);
	
	return processGroup;
}

// Top-level command-line interface
if (import.meta.main) {
	Deno.exit((await main(Deno.args).status).code);
}
