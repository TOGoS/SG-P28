import { assertEquals } from "https://deno.land/std@0.165.0/testing/asserts.ts";
import { parseTargetSpec, TargetSpec } from "./sinkspec.ts";

Deno.test("parse target spec debug", () => {
	const target = parseTargetSpec("debug");
	assertEquals(target, {type:"Debug"});
});

Deno.test("parse target spec osc+debug", () => {
	const target = parseTargetSpec("osc+debug:/some/path");
	assertEquals(target, {type:"OSC+Debug", path:"/some/path"});
});

Deno.test("parse simplest target spec osc+udp", () => {
	const target : TargetSpec = parseTargetSpec("osc+udp://foo.com:1234/some/path");
	const expected : TargetSpec = {
		type: "OSC+UDP",
		targetHostname: "foo.com",
		targetPort: 1234,
		path: "/some/path",
		debugging: false,
	};
	assertEquals(target, expected);
});

Deno.test("parse target spec osc+udp with localhost and debug on", () => {
	const target : TargetSpec = parseTargetSpec("osc+udp://192.168.9.234:1234;localhost=192.168.9.233:1233;debug=on/some/path");
	const expected : TargetSpec = {
		type: "OSC+UDP",
		targetHostname: "192.168.9.234",
		targetPort: 1234,
		localHostname: "192.168.9.233",
		localPort: 1233,
		path: "/some/path",
		debugging: true,
	};
	assertEquals(target, expected);
});

Deno.test("parse target spec osc+udp with localhost and debug on", () => {
	const target : TargetSpec = parseTargetSpec("osc+udp://foo.com:1234;localhost=[0::0]:1235;debug=on/some/path");
	const expected : TargetSpec = {
		type: "OSC+UDP",
		targetHostname: "foo.com",
		targetPort: 1234,
		localHostname: "0::0",
		localPort: 1235,
		path: "/some/path",
		debugging: true,
	};
	assertEquals(target, expected);
});

//// MQTT

Deno.test("parse MQTT target spec with no port", () => {
	const target : TargetSpec = parseTargetSpec("mqtt://foo.com");
	const expected : TargetSpec = {
		type: "MQTT",
		targetHostname: "foo.com",
		topicPrefix: "",
		debugging: false,
	};
	assertEquals(target, expected);
});
Deno.test("parse MQTT target spec with path but no port", () => {
	const target : TargetSpec = parseTargetSpec("mqtt://foo.com/topik");
	const expected : TargetSpec = {
		type: "MQTT",
		targetHostname: "foo.com",
		topicPrefix: "topik",
		debugging: false,
	};
	assertEquals(target, expected);
});

Deno.test("parse MQTT target spec with no prefix", () => {
	const target : TargetSpec = parseTargetSpec("mqtt://foo.com:1234");
	const expected : TargetSpec = {
		type: "MQTT",
		targetHostname: "foo.com",
		targetPort: 1234,
		topicPrefix: "",
		debugging: false,
	};
	assertEquals(target, expected);
});
Deno.test("parse MQTT target spec with no prefix (trailing '/')", () => {
	const target : TargetSpec = parseTargetSpec("mqtt://foo.com:1234/");
	const expected : TargetSpec = {
		type: "MQTT",
		targetHostname: "foo.com",
		targetPort: 1234,
		topicPrefix: "",
		debugging: false,
	};
	assertEquals(target, expected);
});
Deno.test("parse MQTT target spec with prefix with trailing '/'", () => {
	const target : TargetSpec = parseTargetSpec("mqtt://foo.com:1234/globular/");
	const expected : TargetSpec = {
		type: "MQTT",
		targetHostname: "foo.com",
		targetPort: 1234,
		topicPrefix: "globular/",
		debugging: false,
	};
	assertEquals(target, expected);
});
