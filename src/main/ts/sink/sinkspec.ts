function hostnameRegex(capturePrefix:string) {
	return new RegExp(`(?:\\[(?<${capturePrefix}bracketedhostname>[^\\]]+)\\]|(?<${capturePrefix}hostname>[^:;]+))`);
}

const OSCUDP_TARGET_REGEX = new RegExp(
	"^osc\\+udp://" +
	hostnameRegex("target").source +
	":(?<targetport>\\d+)" +
	"(?:;localhost=" +
		hostnameRegex("local").source +
		":(?<localport>\\d+)" +
	")?" +
	"(?:;debug=(?<debug>on|off))?" +
	"(?<path>/.*)$"
);

export type TargetSpec = {
	type: "Debug"
} | {
	type: "OSC+Debug",
	path: string
} | {
	type: "OSC+UDP",
	targetHostname: string,
	targetPort: number,
	localHostname?: string,
	localPort?: number,
	path: string,
	debugging: boolean,
};

function stripUndefs<T>(obj: T): Partial<T> {
	// Copy the object to avoid mutating the original
	const newObj : Partial<T> = {};
	for (const key in obj) {
		if (obj[key] !== undefined) newObj[key] = obj[key];
	}
	return newObj;
}

export function parseTargetSpec(targetSpec:string) : TargetSpec {
	let m : RegExpExecArray|null;
	if( "debug" == targetSpec ) {
		return { type: "Debug" };
	} else if( (m = /^osc\+debug:(?<path>\/.*)$/.exec(targetSpec)) !== null ) {
		const path : string = m.groups!["path"];
		return { type: "OSC+Debug", path };
	} else if( (m = OSCUDP_TARGET_REGEX.exec(targetSpec)) !== null ) {
		// 'bracketedhostname' is to support IPv6 addresses in URIs, like http://[fe80::9908:15:1bb5:39db%18]:1234/some-path
		// Possibly parsing should be stricter.
		const targetHostname : string = m.groups!["targetbracketedhostname"] ?? m.groups!["targethostname"];
		const targetPort : number = +m.groups!["targetport"];
		const path : string = m.groups!["path"];
		// TODO: If localhost not explicitly specified, determine whether this will need to use IPv4 or IPv6
		// and create the listenDatagram using the corresponding localhost address.
		// Otherwise you might get
		// 'Error: An address incompatible with the requested protocol was used. (os error 10047)'
		const localHostname = m.groups!["localbracketedhostname"] ?? m.groups!["localhostname"];
		const localPort : number|undefined = m.groups!["localport"] ? +m.groups!["localport"] : undefined;
		const debugging = (m.groups!["debug"] || "off") == "on";
		return stripUndefs({
			type: "OSC+UDP",
			targetHostname,
			targetPort,
			localHostname,
			localPort,
			path,
			debugging,
		}) as TargetSpec;
	} else {
		throw new Error(`Unrecognized target spec: '${targetSpec}'`);
	}
}
