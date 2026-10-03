# StereoGuard

Detects stereo imbalance using per-participant audio. Original plugin by Kurtzon Audio, maintained by DavidHiFi.

Discord Desktop requires the separately installed VoiceVUMeters native bridge with getParticipantStereoLevels and rmsMid/rmsSide fields. This PR does not install or distribute that bridge. Without an identified per-participant source, the plugin takes no new mute action. Web uses per-user streams where available.

The detector defaults to -22 dB, with a one-second join grace and five-second remute cooldown. The panel shows scores and local protection settings. MIT licensed.
