import { DBus, SystemDBus } from 'npm:@clebert/node-d-bus@1.0.0';
import { Adapter, Device } from 'npm:@clebert/node-bluez@1.0.0';

import * as dbusTypes from 'npm:d-bus-type-system@1.0.0';

// Based on code from https://github.com/clebert/node-bluez

function usleep(duration:number) : Promise<void> {
	return new Promise((resolve,reject) => {
		setTimeout(() => resolve(), duration);
	});
}

class WBBConnector {
	#adapter : Adapter;
	#devices : Device[];
	constructor(adapter : Adapter) {
		this.#adapter = adapter;
		this.#devices = [];
	}
	async connectTo(macAddr : string ) {
		console.log("Waiting for device...");
		let device = await this.#adapter.waitForDevice(macAddr);
		
		console.log("Device: ", device);
		
		//adapter.removeDevice(device);
		await this.#adapter.callMethod('RemoveDevice', [dbusTypes.objectPathType], [device.objectPath]);
		console.log("Device removed");
		
		console.log("Waiting for device again...");
		device = await this.#adapter.waitForDevice(macAddr);
		this.#devices.push(device);
		
		await device.setProperty('Trusted', dbusTypes.booleanType, true);
		console.log("Set trusted!");
		
		await device.callMethod('Pair');
		console.log("Device paired!");
		
		await device.callMethod("Connect");
		console.log("Connected!");
	}
	close() {
		for( const dev of this.#devices ) {
			dev.disconnect();
		}
	}
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
		
		const connector = new WBBConnector(adapter);
		
		try {
			await adapter.setPowered(true);
			await adapter.startDiscovery();
			
			await connector.connectTo('00:21:BD:D1:5C:A9');
			console.log("Woohoo, connected!");
			await usleep(5000);
		} finally {
			connector.close();
			
			unlockAdapter();
		}
	} finally {
		dBus.disconnect();
	}
}

if (import.meta.main) {
	await main();
}
