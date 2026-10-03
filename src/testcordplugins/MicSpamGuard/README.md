# MicSpamGuard

Fork of Kurtzon Audio's plugin, maintained by DavidHiFi. Smoothly balances incoming voice levels and holds sustained extreme loudness at local volume zero. MIT licensed; original author credit retained.

## Recovery

Fresh quiet readings, including zero, count toward the configured auto-unmute interval. If Discord stops providing levels, inactivity starts after the two-second sample grace and uses the same interval. Recovery ramps over 1.5 seconds to 100%. Fresh loud readings cancel the ramp and close the volume again. Off still requires manual restoration. Because missing readings do not prove silence, inactivity recovery is a bounded retry and new loud audio may immediately suppress the user again.

Manual volume changes during a hold remain yours. Manual restore and disabling the plugin restore the saved pre-action baseline. Automatic recovery from an extreme hold targets 100%. Ordinary balancing restores your manual baseline during silence. The collection variant also respects StereoGuard's hold ownership.

## Notices

MicSpamGuard shows one live activity card instead of adding cards to the client's notification queue. It keeps at most three recent participants, replaces each person's previous action with their latest action, and expires each row after three seconds even while hovered. Leaving or switching calls, disabling notifications, changing detail mode and stopping the plugin clear the card immediately. Historical actions remain in the notification log without being replayed as popups.

Standard mode shows concise mute, protection recovery and manual restore actions. Verbose also shows balancing changes and explanations, with the same per-participant rate limiting. Client notification position settings still control the card's position. The activity card uses the existing notification component and does not emit native desktop notifications.

## Validation

Offline behavior checks cover zero readings, missing readings, recovery to 100%, returning blasts, manual overrides, identity conflicts, persistence, notice delivery and notice rate limiting. Synthetic tests do not prove every live voice connection. The detector requires consistent incoming participant identities before any volume write.
