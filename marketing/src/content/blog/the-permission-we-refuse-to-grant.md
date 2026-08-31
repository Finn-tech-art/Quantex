---
title: The one API permission we refuse to grant
description: Every exchange API key Quantex generates is configured read and trade only. Withdrawal permission is never turned on, on any key, for any reason. Here's why that one rule matters more than most of the others.
publishDate: 2026-08-26
---

When Quantex trades on your behalf, it does it through an exchange API key, the same mechanism any automated trading system uses to place real orders on a real exchange. Exchange API keys can typically be granted three kinds of permission: read, trade, and withdrawal.

Quantex's keys are always configured with exactly two of those three: read and trade. Withdrawal permission is never turned on. Not for convenience, not temporarily, not for any account.

## What that actually protects against

An exchange API key with withdrawal permission is, functionally, a second way to move funds off the exchange entirely, separate from whatever controls exist inside the application built on top of it. If a key like that ever leaked, whoever had it could drain the account directly, and no amount of in-app security would matter, because the leak bypassed the app entirely.

A trade-only key can place orders and check balances. It cannot send funds anywhere. If it leaked, the worst it could do is place bad trades, which is recoverable. It could never make the funds simply disappear.

That's the entire reason the rule exists: it turns "key gets compromised" from a catastrophic failure into an annoying one.

## Why this is a rule, not a setting

It would be technically possible to build a version of Quantex where withdrawal permission gets enabled for some operational convenience, maybe to automate a specific internal transfer. That version doesn't exist, on purpose. The moment withdrawal permission touches a live trading key, the whole reason for keeping the two separate stops meaning anything.

So the boundary stays exactly where it is: Quantex can read your balance and place trades with it. It cannot, at the exchange level, ever move it out. Withdrawals from Quantex itself are a completely separate flow, gated behind identity verification, and they never touch the exchange API key at all.
