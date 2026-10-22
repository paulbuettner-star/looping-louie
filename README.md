# Looping Louie

A browser version of the Looping Louie board game by Paul.

**Play:** https://paulbuettner-star.github.io/looping-louie/

- **On one device:** up to 4 players on Q, P, M and Z (or one corner of a tablet each). Empty seats can be CPUs.
- **Online:** one player starts a table. Friends pick it under "Open tables" or tap the invite link. Everyone plays on their own screen with Space or a tap. No sign-in needed.

Online tables go through a small relay on Cloudflare Workers (`relay/`): one Durable Object per room passes each player's state to everyone else at the table over a WebSocket, so it works on any network. The host's browser runs the game, so the host's tab must stay open and in front.

`index.html` is built from the source kept outside this repo; edit the source, not this file.

## Relay

```
cd relay
npm install
npx wrangler dev      # local relay on 127.0.0.1:8787
npx wrangler deploy   # https://looping-louie.looping-louie-relay.workers.dev
```

It only accepts pages served from `paulbuettner-star.github.io` or localhost, and rooms named `lobby` or `louie-xxxx`.
