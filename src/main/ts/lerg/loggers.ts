import Logger from './Logger.ts';
import { ignoreResult, RESOLVED_PROMISE } from '../promises.ts';

// Join two paths together in a way that is useful for my logger things.
// Don't use this for real filesystem paths.
function joinPaths(path1:string, path2:string) : string {
	if( path2 == '' ) return path1;
	if( path1 == '' ) return path2;
	
	if( path2.startsWith('/') ) return path2; // Do I even want to do this
	
	if( path1.endsWith('/') ) return path1 + path2;
	return path1 + '/' + path2;
}

export const NULL_LOGGER: Logger = {
	info() { return RESOLVED_PROMISE; },
	update(_topic, _payload, _retain) { return RESOLVED_PROMISE; },
	subLogger(_path:string) { return this; }
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
	subLogger(path: string): Logger {
		return new MultiLogger(this.#loggers.map(l => l.subLogger(path)));
	}
}

export class ConsoleLogger implements Logger {
	#console : Console;
	#name : string;
	#topicPrefix : string;
	constructor(console:Console, name="", topicPrefix="") {
		this.#console = console;
		this.#name = name;
		this.#topicPrefix = topicPrefix;
	}
	info(message: string): Promise<void> {
		console.info(`# ${this.#name == '' ? '' : this.#name + ': '}${message}`);
		return RESOLVED_PROMISE;
	}
	update(topic: string, payload: string, _retain:boolean): Promise<void> {
		console.log(`${this.#topicPrefix}${topic} ${payload}`);
		return RESOLVED_PROMISE;
	}
	subLogger(path: string): Logger {
		return new ConsoleLogger(this.#console, joinPaths(this.#name, path), this.#topicPrefix + path + '/');
	}
}
