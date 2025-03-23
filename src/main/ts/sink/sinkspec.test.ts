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
