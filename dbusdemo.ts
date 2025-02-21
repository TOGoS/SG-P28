import { SystemDBus } from 'npm:@clebert/node-d-bus@1.0.0';
import { Adapter } from 'npm:@clebert/node-bluez@1.0.0';

// Based on code from https://github.com/clebert/node-bluez

function usleep(duration:number) : Promise<void> {
	return new Promise((resolve,reject) => {
		setTimeout(() => resolve(), duration);
	});
}

async function main() {
	const dBus = new SystemDBus();
	await dBus.connectAsExternal();

	try {
		await dBus.hello();
		
		const [adapter] = await Adapter.getAll(dBus);
		if( !adapter ) {
			throw new Error("No bluez adapter found");
		}
		
		const unlockAdapter = await adapter.lock.aquire();
		
		let device;
		
		try {
			await adapter.setPowered(true);
			await adapter.startDiscovery();
			
			device = await adapter.waitForDevice('00:21:BD:D1:5C:A9');
			
			console.log("Device: ", device);
			
			await device.connect();
			
			console.log("Connected!");
			
			// This doesn't seem to quite do the job.
			// No js* device shows up in /dev/input.
			// After the remove/trust/pair/connect dance in bluetoothctl, it does show up.
			// Goal is to do whatever bluetoothctl does.
					
			while( true ) {
				await usleep(1000);
			}
		} finally {
			if( device != null ) device.disconnect();
			unlockAdapter();
		}
	} finally {
		dBus.disconnect();
	}
}

if (import.meta.main) {
	await main();
}
