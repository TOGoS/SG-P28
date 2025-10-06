# SG-P28 Devlog

## 2025-09-18

I was using the [SG-P27 devlog](https://gitlab.com/TOGoS/SG-P27/-/blob/master/DEVLOG.org).

Now this project has its own DEVLOG.

Refactored [dashboard.ts](./dashboard.ts) earlier today to use [TUIAppFramework3](https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/tuiappframework3.ts),
but it was doing all its own rendering.

Now I have updated it to use [Components2](https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/termdraw/boxdrawcomponents2.ts)
to turn an abstract and flexible representation of the view
into text on the screen.

![Screenshot: Now using the component library!](http://picture-files.nuke24.net/uri-res/raw/urn:bitprint:KCWIDYRGAAS4IOHGVTTSDO6QKT4XEHWA.KORUFDXS7LU747E2Q6ICE45GA2LAJA45NMJIIDQ/20250919T21-TUI3Dashboard.png)

It's horribly inefficient and kind of a lot of code to set up
the dumb flex components.  Should be fixable with enough functions
and some memoization, though.  Later.

## 2025-10-05

An update: I had "do something for SMP" on my to-do list all day,
but couldn't bring myself to start because my office was too messy,
so I organized it a little bit.

It's still pretty messy, but I finally moved a filing cabinet into the corner so it's less in the way.

Then I finally got the WBBs out (didn't turn them on--just got them out).

Then I fired up `wbbconnector-demo`, which crashed with a surprising `StateIsNotOnlineError`.
I ran it again and it did not crash, so I suspected something was wrong with my
`mkPromiseChain` function, which should have ensured that `connect` actually completed
before `publish` was ever called.

After a bit of printf debugging I realized that the promise chain itself was working fine,
but that `MQTTLogger#subLogger` was creating a new `MQTTLogger` that shared the `MqttClient`
but not the same action queue / promise chain thing, which meant that connecting,
then creating a sublogger, than logging with that would disregard whether the connection
had completed.

Fixed by constructing `MQTTLogger`s with the action queue rather than the MQTT client itself.
