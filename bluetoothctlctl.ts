class BluetoothCtlWrapper {
	private process: Deno.ChildProcess;
	private stdinWriter: WritableStreamDefaultWriter<Uint8Array>;
	private stdoutReader: ReadableStreamDefaultReader<Uint8Array>;
	private stderrReader: ReadableStreamDefaultReader<Uint8Array>;

	constructor(command: string[]) {
		const cmd = new Deno.Command(command[0], {
			args: command.slice(1),
			stdin: "piped",
			stdout: "piped",
			stderr: "piped"
		});
		this.process = cmd.spawn();
		this.stdinWriter = this.process.stdin.getWriter();
		this.stdoutReader = this.process.stdout.getReader();
		this.stderrReader = this.process.stderr.getReader();
	}

	async sendCommand(command: string): Promise<void> {
		const encoder = new TextEncoder();
		const data = encoder.encode(command + "\n");
		await this.stdinWriter.write(data);
	}

	async *output(): AsyncIterableIterator<string> {
		const decoder = new TextDecoder();
		while (true) {
			const { value, done } = await this.stdoutReader.read();
			if (done) break;
			yield decoder.decode(value);
		}
	}

	async close(): Promise<void> {
		this.stdinWriter.close();
		this.stdoutReader.releaseLock();
		this.process.stdin.close();
		this.stdoutReader.cancel();
		this.stderrReader.cancel();
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
		for await (const output of wrapper.output()) {
			console.log(output);
		}
		await wrapper.close();
	})();
}
