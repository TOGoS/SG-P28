export default interface Logger {
	info(message: string): Promise<void>;
	update(topic: string, payload: string, retain?: boolean): Promise<void>;
}
