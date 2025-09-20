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
