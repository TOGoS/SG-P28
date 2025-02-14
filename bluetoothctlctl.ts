import { toLines } from './src/main/ts/streamiter.ts';

class BluetoothCtlWrapper {
	private process: Deno.ChildProcess;
	private stdinWriter: WritableStreamDefaultWriter<Uint8Array>;
	public stdout: ReadableStream<Uint8Array>;
	public stderr: ReadableStream<Uint8Array>;

	constructor(command: string[]) {
		const cmd = new Deno.Command(command[0], {
			args: command.slice(1),
			stdin: "piped",
			stdout: "piped",
			stderr: "piped"
		});
		this.process = cmd.spawn();
		this.stdinWriter = this.process.stdin.getWriter();
		this.stdout = this.process.stdout;
		this.stderr = this.process.stderr;
	}

	async sendCommand(command: string): Promise<void> {
		const encoder = new TextEncoder();
		const data = encoder.encode(command + "\n");
		await this.stdinWriter.write(data);
	}
	
	async close(): Promise<void> {
		this.stdinWriter.close();
		this.process.stdin.close();
		this.stdout.cancel();
		this.stderr.cancel();
		await this.process.status;
	}
}

// Top-level command-line interface
if (import.meta.main) {
	const command = Deno.args.length > 0 ? Deno.args : ["bluetoothctl"];
	const wrapper = new BluetoothCtlWrapper(command);

	// Example usage: send a command and print output
	(async () => {
		await wrapper.sendCommand("list");
		
		const stdoutLines = toLines(wrapper.stdout);
		const stderrLines = toLines(wrapper.stderr);
		
		const logOutput = async () => {
			for await (const line of stdoutLines) {
				console.log(line);
			}
		};
		
		const logError = async () => {
			for await (const line of stderrLines) {
				console.error(line);
			}
		};
		
		await Promise.all([logOutput(), logError()]);
		await wrapper.close();
	})();
}
