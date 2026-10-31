# What the client's scripts do, replayed

FusionFall drives part of each map scene with its own scripts. UnityPackFF writes each node's scripts and their fields into its `extras.scripts` (`export_gltf.py --scripts`; ff-unpack's world stage does this), and `src/scripts.js` replays two of them. Fields are as Unity stores them: vectors are in Unity's left-handed space, so the motion is worked out there and mirrored into glTF's (x negated, rotations (x, −y, −z, w)).

## Moving platforms (`EpPlatformTrigger`)

The Infected Zones' platforms move on the client, from their own fields, without the server. Map_04_05 (Dizzy World) has 42. With the platform's world position P, rotation R and local scale s at the start, a timer runs up by `velocity` per second to 1 and back down to 0 (on the way back the curves take the other half of their circle). `moveType`:

| Type | Motion |
|---|---|
| `Line` | P + R·(to − from)·e(t), with the ease e(t) = clamp(t − sin(2πt)·0.15) |
| `xCurve`, `yCurve`, `zCurve` | half a circle across from → to, in the plane the name leaves out: P + R·(s·(r·circle(t) + (to − from)/2)), r = \|to − from\|/2 |
| `xRotate`, `zRotate` | in place, turning e(t)·180°·`spinvelocity` about its own x or z |
| `xRotate_Move`, `zRotate_Move` | both |
| `Line_Path`, `xRotate_Path`, `zRotate_Path` | along the waypoints from `head` (each `Waypoint`'s `point`, chained by `next`), looping; P + R·(s·point(t)); the rotating ones turn 360°·`spinvelocity` per loop |

A `Line` platform whose `from` and `to` are the same doesn't move. The client also stops updating platforms far from the player and lets switches turn them off; the area viewer moves them all, all the time.

## Effects (`EffectEmitterController`)

The client places some effects at runtime: an emitter names a prefab (`nifObject`) and particle systems (`particles`). The Infected Zones' barriers are 18 of these around Dizzy World, each an `EPbarrier1` force-field emitter. A world pack's manifest lists the effect prefabs it holds (`effects`: `{ name: { file, prefab, path } }`, `name` being the prefab's name in lower case); ff-three loads each, puts it on the emitter's node and loops its clips. The particle systems aren't drawn yet: that needs Unity's legacy particles in three.js.

## Not replayed

The other Infected Zone elements' meshes are drawn but what they do needs a player: jump pads (`EpJumppadTrigger`), launchers, slides (`EpSlopeTrigger`, which follow waypoints), ziplines, rings. `EPElementController` spawns effects by index, which a pack doesn't map yet.
