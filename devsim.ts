import { ensureDir, ensureFile } from 'https://deno.land/std@0.224.0/fs/mod.ts';
import { delay } from 'https://deno.land/std@0.224.0/async/mod.ts';

const dir = Deno.args[0];
if (!dir) {
	console.error(
		'Please provide a directory where the fake devices should be created.',
	);
	Deno.exit(1);
}

await ensureDir(dir);

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
	const devicePath = `${dir}/${name}`;
	try {
		await createFifo(devicePath);
		devices[devicePath] = true;
		info(`Created device: ${devicePath}`);
		if (simulatedDeviceType === 'WiiBalanceBoard') {
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
	while (devices[devicePath] && running) {
		const data = new Uint8Array(24);
		crypto.getRandomValues(data);
		try {
			await Deno.writeFile(devicePath, data);
		} catch (err) {
			throw new AggregateError(
				[err],
				`Error writing to device at ${devicePath}`,
			);
		}
		await delay(1000);
	}
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
	info('Cleaning up...');
	for (const devicePath in devices) {
		await removeDevice(devicePath);
	}
}

Deno.addSignalListener('SIGTERM', () => {
	info('Received SIGTERM, stopping...');
	running = false;
});

try {
	await simulateDevices();
} finally {
	await cleanup();
	Deno.exit(0);
}