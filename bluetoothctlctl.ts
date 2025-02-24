import { assertEquals } from 'https://deno.land/std@0.165.0/testing/asserts.ts';
import { decodeUtf8 } from './src/main/ts/streamiter.ts';
import { toChunkIterator, toLines } from './src/main/ts/streamiter.ts';
import ProcessLike from './src/main/ts/process/ProcessLike.ts';
import { ProcessGroup } from './src/main/ts/process/ProcessGroup.ts';
import { EXITCODE_ABORTED, functionToProcessLike, newPseudoPid } from './src/main/ts/process/util.ts';
import { chunksToSimpleCommands } from './src/main/ts/simplecommandparser.ts';

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

type SimpleCommand = {args: string[]};

// This might be more complex than needed because the
// weirdness is from bluetoothctl emitting two things at once
// and the characters got jumbled up:
// deno-lint-ignore no-control-regex
const escSeqRegex = /\x1b\[\d*C?[^m\x1b]*[m]?/g;

const btcPrarseRegex = /^\[([^\]]+)\]#\s+(.*)/;

// HEY Maybe if bluetoothctl is just using d-bus, I could just talk D-bus instead of messing with bluetoothctl's gross output?
// Well, Deno D-Bus libraries seem to be lacking.

type BluetoothCtlEvent = {
	eventType: "PleaseEnterPIN",
	sourceLine: string
} | {
	eventType: "New"|"Delete",
	subjectType: "Device"|"Controller"|string,
	subjectId: string, // MAC address
	subjectName: string,
	sourceLine: string
} | {
	eventType: "Change",
	subjectType: "Device"|"Controller"|string,
	subjectId: string, // MAC address
	propertyName: string,
	value: string,
	sourceLine: string
} | {
	eventType: "Unknown",
	notes: string[],
	sourceLine: string
}

// TODO: Define types for the data I expect from BluetoothCtl
function* parseBluetoothCtlLines(line: string) : Iterable<BluetoothCtlEvent> {
	const lines = line.split(/[\r\n]+/);
	for( const sourceLine of lines ) {
		let m : RegExpExecArray|null;
		let line = sourceLine.replaceAll(escSeqRegex, '');
		let anythingParsed = false;
		while( (m = btcPrarseRegex.exec(line)) != null ) {
			anythingParsed = true;
			const subjectType = m[1];
			let payload1 = m[2];
			let remainingLine : string;
			
			// This, too, might have happened because bluetoothctl was not
			// careful to emit things one at a time, and so isn't
			// really a sequence I should be looking for:
			if( (m = /^(\[agent\] Enter PIN code:)\s+(.*)/.exec(payload1)) != null ) {
				yield {
					eventType: "PleaseEnterPIN",
					sourceLine
				};
				
				payload1 = m[1];
				remainingLine = m[2];
			} else if( (m = /\[(CHG|DEL|NEW)\]\s+(.*)/.exec(payload1)) != null ) {
				const typeCode = m[1];
				const payload2 = m[2];
				
				let evt : BluetoothCtlEvent;
				let eventType : typeof evt.eventType;
				switch( typeCode ) {
				case "CHG": eventType = "Change"; break;
				case "NEW": eventType = "New"   ; break;
				case "DEL": eventType = "Delete"; break;
				default: throw new Error(`Bad event type string: ${m[1]}`);
				}
				
				if( eventType == "Change" ) {
					if( (m = /(?<type>Device|Controller)\s+(?<id>\S+)\s+(?<prop>.*?):\s+(?<value>.*)/.exec(payload2)) != null ) {
						yield {
							eventType,
							propertyName: m.groups?.prop || "?",
							subjectId: m.groups?.id || "?",
							subjectType: m.groups?.type || "?",
							value: m.groups?.value || "?",
							sourceLine
						};
					} else {
						yield {
							eventType: "Unknown",
							notes: ["Looks like a change, but failed to parse payload2: "+payload2],
							sourceLine,
						};
					}
				} else {
					if( (m = /(?<type>Device|Controller)\s+(?<id>\S+)\s+(?<name>.*)/.exec(payload2)) != null ) {
						yield {
							eventType,
							subjectType: m.groups?.type || "?",
							subjectId: m.groups?.id || "?",
							subjectName: m.groups?.name || "?",
							sourceLine
						};
					} else {
						yield {
							eventType: "Unknown",
							notes: ["Looks like a new|delete, but failed to parse payload2: "+payload2],
							sourceLine,
						};
					}
				}
				
				remainingLine = '';
			} else {
				yield {
					eventType: "Unknown",
					notes: ["Didn't recognize payload1: "+payload1],
					sourceLine
				}
				remainingLine = '';
			}
			
			line = remainingLine;
		}
		if( !anythingParsed ) {
			/*yield {
				eventType: "Unknown",
				notes: ["Didn't recognize this line at all: "+line],
				sourceLine
			};*/
		}
	}
}

function collect<T>( source:Iterable<T> ) : T[] {
	const arr = [];
	for( const item of source ) arr.push(item);
	return arr;
}

Deno.test('parseBluetoothCtlLine', () => {
	const sourceLine1 = "\x1b[0;94m[bluetooth]\x1b[0m# [\x1b[0;92mNEW\x1b[0m] Device 00:21:BD:D1:5C:A9 Nintendo RVL-WBC-01";
	const sourceLine2 = "\x1b[0;94m[bluetooth]\x1b[0m# [\x1b[0;93mCHG\x1b[0m] Device 00:21:BD:D1:5C:A9 RSSI: 0xffffffca (-54)";
	const input =
		"\n" +
		sourceLine1 + "\n" +
		"# foo, garbage line\n" +
		sourceLine2 + "\n" +
		"# Blah more stuff\n";
	//const input = "\u001b[0;94m[bluetooth]\u001b[0m#                         \r[\u001b[0;93mCHG\u001b[0m] Controller 40:F4:C9:6F:12:6D Pairable: yes"
	const outputs = collect(parseBluetoothCtlLines(input));
	assertEquals(outputs, [
		{eventType: "New"   , subjectType: "Device", subjectId: "00:21:BD:D1:5C:A9", subjectName: "Nintendo RVL-WBC-01", sourceLine: sourceLine1},
		{eventType: "Change", subjectType: "Device", subjectId: "00:21:BD:D1:5C:A9", propertyName: "RSSI", value: "0xffffffca (-54)", sourceLine: sourceLine2},
	]);
});

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

		for await (const cmdArgs of chunksToSimpleCommands(decodeUtf8(toChunkIterator(stdinReader)))) {
			if (signal.aborted) return 1;
						
			// A few different ways to quit:
			// - `kill` will forcibly kill the group and should result in a nonzero exit code
			// - `exit` will close stdin and should result in a zero exit code
			// - `btc quit` or `btc exit` will tell bluetoothctl to close,
			//   which should in turn result in this process group exiting
			
			if (cmdArgs[0] === "kill") {
				console.log("# Killing process group...");
				abortController.abort("kill command entered");
				break;
			}
			if (cmdArgs[0] === "exit" || cmdArgs[0] == 'bye' || cmdArgs[0] == 'q') {
				console.log("# Exiting...");
				await procStdinWriter.close();
				break;
			}
			if (cmdArgs[0] == "echo") {
				console.log(cmdArgs.slice(1).join(" "));
				break;
			}
			if (cmdArgs[0] == "btc") {
				const data = encoder.encode(cmdArgs.slice(1).join(' ') + "\n");
				console.log(`# Sent command to bluetoothctl: ${data}`);
				await procStdinWriter.write(data);
				continue;
			}
			console.log(`Unrecognized command: '${cmdArgs[0]}'`);
		}
		return 0;
	}, {name: "stdin-piper"});
	mainProcess.wait().then(() => stdinAbortController.abort());
	
	const stdoutProcess = functionToProcessLike(async (signal) => {
		
		// TODO: Parse bluetoothctl output!
		
		signal.addEventListener("abort", () => stdoutReader.cancel());
		const stdoutLines = toLines(decodeUtf8(toChunkIterator(stdoutReader)));
		for await (const line of stdoutLines) {
			if (signal.aborted) return EXITCODE_ABORTED;
			
			for( const parsed of parseBluetoothCtlLines(line) ) {
				console.log("event: " + JSON.stringify(parsed));
			}
		}
		return 0;
	}, {name: "stdout-piper"});
	
	const stderrProcess = functionToProcessLike(async (signal) => {
		signal.addEventListener("abort", () => stderrReader.cancel());
		const stderrLines = toLines(decodeUtf8(toChunkIterator(stderrReader)));
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
