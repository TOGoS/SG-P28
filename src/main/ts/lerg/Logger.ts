/**
 * Not a super well-thought-out API.
 * Probably what I should do is just have a function that accepts a path and text,
 * and if the path ends with 'chat', some loggers could handle that specially
 * if they want.
*/
export default interface Logger {
	info(message: string): Promise<void>;
	update(topic: string, payload: string, retain?: boolean): Promise<void>;
	subLogger(path:string) : Logger;
}
