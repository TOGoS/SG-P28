// Take a 'directory path' and append a '/' if needed so that the return value can serve as a prefix
export function dirPathToPrefix(path:string, zeroCase:string) : string {
	return path.length == 0 ? zeroCase : path.endsWith('/') ? path : path + '/';
}
