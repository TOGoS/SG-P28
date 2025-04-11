# SG2100-P28, a.k.a. WBBReader2

## oscify.ts

A Deno script to read data from a `/dev/input/eventX` device and send
it over OSC, for the purpose of having a group of cheap linux boxen
(maybe Raspberry Pis) collect events from a swarm of balance boards
to control some music or something.


## wbbconnector.ts

A Deno script that will talk to bluetoothd over D-bus to automatically
connect to a preconfigured list of bluetooth devices,
watch for their corresponding `/dev/input/event*` device file to appear,
and log information to the specified `--logger`, which may be an MQTT channel.

To run:

```
deno run --unstable-net --check=all --allow-all wbbconnector.ts v2 "--logger=mqtt://localhost/wbbconnector1" "00:21:BD:D1:5C:A9" "58:BD:A3:AC:20:AD"
```

Replace `192.168.9.9:9901` with the host:port to which you want to send OSC packets.
Replace the MAC addresses with those of whatever devices you want to connect.

More tan one logger may be specified.
`--logger=console` to print information to standard output.

To connect the Wii Balance Boards, start `wbbconnector`,
then power the on and hit the red button on the bottom of each.
It can take a while before the devices show up.
Once they do, you should see a change in the program's output from

> Checking on 58:BD:A3:AC:20:AD (undefined)

to

> Checking on 58:BD:A3:AC:20:AD (connected)

and eventually some stuff like

```
# wbb-connector-v2: FS watch event: {"kind":"create","paths":["/dev/input/event3"],"flag":null}
# wbb-connector-v2: inputEventDeviceAppeared: Associating 58:BD:A3:AC:20:AD with /dev/input/event3
# wbb-connector-v2: FS watch event: {"kind":"modify","paths":["/dev/input/event3"],"flag":null}
# wbb-connector-v2: FS watch event: {"kind":"create","paths":["/dev/input/js0"],"flag":null}
# wbb-connector-v2: FS watch event: {"kind":"modify","paths":["/dev/input/js0"],"flag":null}
# wbb-connector-v2: FS watch event: {"kind":"modify","paths":["/dev/input/js0"],"flag":null}
# wbb-connector-v2: FS watch event: {"kind":"modify","paths":["/dev/input/event3"],"flag":null}
# wbb-connector-v2: readEvents(/dev/input/event3): Opening '/dev/input/event3'...
```

Once a device is connected, pass its MAC address and input path to `oscify.ts` or `multioscify.ts`.


## multioscify.ts

Can read from multiple WBBs and forward events over OSC.
Forwarding configuration (input device -> OSC target) is controlled via MQTT.


## FAQ

### I get Permission Denied errors when I try to read from /dev/input/eventN devices!

Maybe try `usermod -a -G input $your_username`.


## TODO

- [ ] `restart` option for readers
- [ ] maybe readers should allow multiple targets?
  - shouldn't need to restart reader when target changes
- [ ] An orchestrator that automatically controls `multioscify` based on path guesses from `wbbconnector`
  - Probably will want to use shared environment variables defined in a `.env.sh` to configure
    all these things
