import Logger from './Logger.ts';
import { ignoreResult, RESOLVED_PROMISE } from '../promises.ts';

export const NULL_LOGGER: Logger = {
	info() { return RESOLVED_PROMISE; },
	update(_topic, _payload, _retain) { return RESOLVED_PROMISE; },
};

export class MultiLogger implements Logger {
	#loggers : Logger[];
	constructor(loggers:Logger[]) {
		this.#loggers = loggers;
	}
	info(message: string): Promise<void> {
	  return ignoreResult(Promise.all(this.#loggers.map(l => l.info(message))));
	}
	update(topic: string, payload: string, retain?:boolean): Promise<void> {
		return ignoreResult(Promise.all(this.#loggers.map(l => l.update(topic, payload, retain))));
	}
}

export class ConsoleLogger implements Logger {
	#console : Console;
	constructor(console:Console) {
		this.#console = console;
	}
	info(message: string): Promise<void> {
		console.info(`# ${message}`);
		return RESOLVED_PROMISE;
	}
	update(topic: string, payload: string, _retain:boolean): Promise<void> {
		console.log(`${topic} ${payload}`);
		return RESOLVED_PROMISE;
	}
}
