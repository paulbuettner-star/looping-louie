# Looping Louie

A browser version of the Looping Louie board game by Paul.

**Play:** https://paulbuettner-star.github.io/looping-louie/

- **On one device:** up to 4 players on Q, P, M and Z (or one corner of a tablet each). Empty seats can be CPUs.
- **Online:** one player starts a table and sends the invite link. Everyone plays on their own screen with Space or a tap. No sign-in needed.

Online tables run peer to peer over WebRTC with [PeerJS](https://peerjs.com) 1.5.5 (MIT, see `PEERJS-LICENSE`). The host's browser runs the game, so the host's tab must stay open and in front.

`index.html` is built from the source kept outside this repo; edit the source, not this file.
