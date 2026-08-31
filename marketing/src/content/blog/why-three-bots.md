---
title: Why three bots, not one
description: Grid, DCA, and Momentum aren't three versions of the same idea. They're built for three different kinds of market, and picking the wrong one is worse than picking none at all.
publishDate: 2026-08-20
---

Most trading bots on most platforms are variations on a single idea dressed up with different names. Quantex ships three, and they're actually different tools for actually different situations.

## Grid: for a market that isn't going anywhere

A grid bot picks a price range and places a ladder of buy and sell orders across it. When the price dips into a lower rung, it buys. When it climbs back up, it sells. It repeats that for as long as the price keeps bouncing inside the range.

This is the strategy for a market that's choppy but not trending, the kind of price action that would drive a manual trader crazy trying to time. A grid bot doesn't try to guess direction at all. It just works the range.

## DCA: for when you don't trust your own timing

Dollar-cost averaging buys on a fixed schedule regardless of what the price is doing that day. It's the opposite of trying to find the perfect entry, and that's the point. A single bad entry can't sink a position that was never staked on one moment in the first place.

DCA is slow by design. It's the strategy for building a position over weeks or months, not the one for a market you expect to move fast.

## Momentum: for when something is actually happening

Momentum bots do the one thing grid and DCA deliberately avoid: they take a directional bet. Once a trend is confirmed, a momentum bot sizes into it, and it steps aside the moment that trend stalls out. It's built for the market phases the other two strategies are built to ignore.

## Why this matters

A grid bot let loose on a strongly trending market will keep selling into strength and buying into weakness, exactly backwards. A momentum bot let loose on a flat, choppy market will get chopped up by false signals. The strategies aren't interchangeable, and treating them like they are is how a good tool ends up producing a bad result.

That's why Quantex asks which one you want, instead of picking for you.
