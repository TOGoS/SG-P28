import { ensureDir, ensureFile } from 'https://deno.land/std@0.224.0/fs/mod.ts';
import { delay } from 'https://deno.land/std@0.224.0/async/mod.ts';

type Command = AndCommand | CleanupCommand | ExitCommand;
type CleanupCommand = {
	commandType: 'cleanup';
};
type ExitCommand = {
	commandType: 'exit';
	exitCode: number;
};
type AndCommand = {
	commandType: 'and';
	subcommands: Command[];
};

function parseCommand(command: string): Command {
	command = command.trim();
	const andParts = command.split('&&');
	if (andParts.length > 1) {
		return {
			commandType: 'and',
			subcommands: andParts.map(parseCommand),
		};
	}
	const cmdArgs = command.split(' ').map((s) => s.trim());
	if (cmdArgs[0] === 'cleanup') return { commandType: 'cleanup' };
	if (cmdArgs[0] === 'exit') {
		return { commandType: 'exit', exitCode: parseInt(cmdArgs[1]) };
	}
	throw new Error(`Invalid command: ${cmdArgs[0]}`);
}

async function runCommand(command: Command) {
	info(`Running command: ${JSON.stringify(command)}`);
	if (command.commandType === 'cleanup') {
		await cleanup();
	} else if (command.commandType === 'exit') {
		Deno.exit(command.exitCode);
	} else if (command.commandType === 'and') {
		for (const subcommand of command.subcommands) {
			await runCommand(subcommand);
		}
	}
}

type FilePath = string;

let onTerm: Command = parseCommand('cleanup && exit 1');
let onInt: Command = parseCommand('cleanup && exit 1');
const eventSimDirs: FilePath[] = [];

for (const arg of Deno.args) {
	let m: RegExpMatchArray | null;
	if ((m = /^--on-term=(\d+)$/.exec(arg)) !== null) {
		onTerm = parseCommand(m[1]);
	} else if ((m = /^--on-int=(\d+)$/.exec(arg)) !== null) {
		onInt = parseCommand(m[1]);
	} else if ((m = /^--event-sim-dir=(.+)$/.exec(arg)) !== null) {
		eventSimDirs.push(m[1]);
	} else {
		console.error(`Unrecognized option: ${arg}`);
		Deno.exit(1);
	}
}

for (const dir of eventSimDirs) {
	await ensureDir(dir);
}

const devices: Record<string, boolean> = {};
let running = true;

function info(message: string) {
	console.log(`# ${message}`);
}

function summarizeError(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

async function createFifo(path: string) {
	try {
		await ensureFile(path);
		await Deno.remove(path);
		const command = new Deno.Command('mkfifo', { args: [path] });
		const process = command.spawn();
		const status = await process.status;
		if (!status.success) {
			throw new Error(`Failed to create FIFO at ${path}`);
		}
	} catch (err) {
		throw new AggregateError([err], `Error creating FIFO at ${path}`);
	}
}

async function createDevice(
	name: string,
	simulatedDeviceType: 'WiiBalanceBoard' | 'Empty',
) {
	const dir = eventSimDirs[Math.floor(Math.random() * eventSimDirs.length)];
	const devicePath = `${dir}/${name}`;
	try {
		await createFifo(devicePath);
		devices[devicePath] = true;
		info(`Created ${simulatedDeviceType} device: ${devicePath}`);
		if (simulatedDeviceType === 'WiiBalanceBoard') {
			info(`Starting WiiBalanceBoard simulator for ${devicePath}...`);
			writeToDevice(devicePath);
		}
	} catch (err) {
		throw new AggregateError([err], `Error creating device ${name}`);
	}
}

async function removeDevice(devicePath: string) {
	try {
		await Deno.remove(devicePath);
		if (devices[devicePath]) {
			delete devices[devicePath];
		}
		info(`Removed device: ${devicePath}`);
	} catch (err) {
		throw new AggregateError([err], `Error removing device at ${devicePath}`);
	}
}

async function writeToDevice(devicePath: string) {
	info(`Starting writing to device at ${devicePath}...`);
	try {
		const writeStream = await Deno.open(devicePath, { write: true });
		try {
			while (devices[devicePath] && running) {
				const data = new Uint8Array(24);
				crypto.getRandomValues(data);
				try {
					info(`Writing ${data.length} bytes to ${devicePath}...`);
					await writeStream.write(data);
					info(`wrote ${data.length} bytes to ${devicePath}`);
				} catch (err) {
					throw new AggregateError(
						[err],
						`Error writing to device at ${devicePath}`,
					);
				}
				await delay(1000);
			}
		} finally {
			await writeStream.close();
		}
	} finally {
		await Deno.remove(devicePath);
	}
	info(`Stopped writing to device at ${devicePath}`);
}

async function simulateDevices() {
	while (running) {
		const action = Math.random() > 0.5 ? 'add' : 'remove';
		if (action === 'add') {
			const deviceType = Math.random() > 0.5 ? 'Empty' : 'WiiBalanceBoard';
			const deviceName = `${deviceType}_${Date.now()}`;
			await createDevice(deviceName, deviceType);
		} else {
			const deviceKeys = Object.keys(devices);
			if (deviceKeys.length > 0) {
				const deviceToRemove =
					deviceKeys[Math.floor(Math.random() * deviceKeys.length)];
				await removeDevice(deviceToRemove);
			}
		}
		await delay(2000);
	}
}

async function cleanup() {
	running = false;
	info('Cleaning up...');
	for (const devicePath in devices) {
		await removeDevice(devicePath);
	}
}

Deno.addSignalListener('SIGTERM', async () => {
	info('Received SIGTERM, stopping...');
	await runCommand(onTerm);
});
Deno.addSignalListener('SIGINT', async () => {
	info('Received SIGINT, stopping...');
	await runCommand(onInt);
});

await simulateDevices();
