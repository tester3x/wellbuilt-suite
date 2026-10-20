# Shared account gate rollout

Mirrors the canonical protected account gate, bounded transport/superseded recovery, reconnect wake and queued account-change checks from Equipment73. All apps retain their existing identity and business-operation authorization. Companion apps offer Return to Suite on gate error without clearing login. The hub remains the hub; ETC/TicketTime remain standalone local tools with no new WB login requirement.

JSA and Mobile app-open paths wait for the outer gate and do not run a competing restore. Suite/Tickets/Mobile/JSA local owner reads are fenced against replacement of the live SDK user. Equipment already has its SDK lease fence and installed73 recovery.

Source checks/build/installation pending. Raw device logs and customer records remain outside Git. No backend/Hosting changes or work-record submissions. TicketTime unrelated laptop working changes are preserved, not bundled into this repair.
